import test from 'node:test';
import assert from 'node:assert/strict';
import { entryTerms } from '@/lib/listingView';
import { readFileSync } from 'node:fs';
import { lastCellPresentation, STACKED_CELL_CLASS } from '@/lib/keyFactsGrid';

/**
 * The listing detail page's KeyFacts grid, in the two places it can be wrong
 * without anyone noticing: what it says about money, and what it leaves behind
 * when the last row is short.
 *
 * The short-row half has now been reported from production twice — once as a
 * blank filler box, once as the empty right half of the stretched cell that
 * replaced it — so the cases below are the real ones, not invented shapes.
 */

test('a deposit on its own stays a deposit — no invented advance or commission', () => {
  // Today's live shape: `properties` carries deposit_months and nothing else
  // (verified against the real schema), so the other two arrive undefined.
  const terms = entryTerms({ deposit_months: 3 });

  assert.deepEqual(terms.parts, [3]);
  assert.equal(terms.itemized, false, 'one figure is not a breakdown');
  assert.equal(terms.total, 3);
});

test('the three entry costs render as the notation the agent wrote', () => {
  // "Garantie : 3 + 1 + 1" — deposit, advance, commission, in that order.
  const terms = entryTerms({ deposit_months: 3, advance_months: 1, commission_months: 1 });

  assert.deepEqual(terms.parts, [3, 1, 1]);
  assert.equal(terms.itemized, true);

  // The total is derived and available, but it is not what the cell leads
  // with: "Garantie : 5 mois" is exactly the overstatement splitting these
  // into three fields was meant to undo.
  assert.equal(terms.total, 5);

  // "4+1" — a deposit and an advance, commission never stated.
  assert.deepEqual(entryTerms({ deposit_months: 4, advance_months: 1 }).parts, [4, 1]);
});

test('NULL is "not stated" and is never printed as a zero', () => {
  // NULL and 0 are different claims: "nobody told us" vs "none required".
  // Neither may be filled in from a "standard" figure — there is no standard,
  // and inventing one to fill a UI slot is the thing this codebase refuses.
  for (const missing of [null, undefined, '']) {
    const terms = entryTerms({ deposit_months: 3, advance_months: missing, commission_months: missing });
    assert.deepEqual(terms.parts, [3]);
  }

  // A real zero IS a claim, and survives.
  assert.deepEqual(entryTerms({ deposit_months: 3, advance_months: 0 }).parts, [3, 0]);

  // No deposit at all: the notation is positional, so there is nothing to
  // render and the cell does not appear.
  assert.equal(entryTerms({ deposit_months: null, advance_months: 1 }), null);
  assert.equal(entryTerms({}), null);
  assert.equal(entryTerms(null), null);
});

test('a gap in the middle is not papered over with a placeholder', () => {
  // "3 + _ + 1" is not a notation anyone writes, and printing a placeholder
  // would state something the listing does not. Only the contiguous run is
  // emitted, so a commission with no advance reports the deposit alone.
  const terms = entryTerms({ deposit_months: 3, advance_months: null, commission_months: 1 });
  assert.deepEqual(terms.parts, [3]);
  assert.equal(terms.itemized, false);
});

test('the deposit cell states the deposit alone, never the entry total', () => {
  // The grid shows both: "Garantie : 3 mois" (what comes back) and
  // "Conditions d'entrée : 3 + 1 + 1" (what has to be paid to sign). The first
  // reads parts[0] and nothing else — a "3 + 1 + 1" printed as "Garantie :
  // 5 mois" claims two months of refundable deposit that are actually rent and
  // commission, which is the bug the three-field split exists to prevent.
  const terms = entryTerms({ deposit_months: 3, advance_months: 1, commission_months: 1 });
  assert.equal(terms.parts[0], 3);
  assert.equal(terms.parts.join(' + '), '3 + 1 + 1');
});

test('a deposit with nothing beside it produces no second money cell', () => {
  // `itemized` is what KeyFacts gates the entry-terms cell on. With only a
  // deposit stated, repeating "3" under a second heading would imply a
  // breakdown nobody gave us — and filling in the "+ 1 + 1" that usually
  // follows would be inventing money a customer would budget for.
  assert.equal(entryTerms({ deposit_months: 3 }).itemized, false);
  assert.equal(entryTerms({ deposit_months: 3, advance_months: 1 }).itemized, true);
});

test('a full row leaves the last cell an ordinary stacked cell', () => {
  // The stacked treatment every other cell wears, asserted literally here so
  // KeyFacts and this file cannot drift apart on what "ordinary" looks like.
  assert.equal(STACKED_CELL_CLASS, 'flex flex-col gap-2');

  // 4 cells fill both a 2-up and a 4-up row; 8 does the same. Nothing to
  // correct, so nothing is corrected — no span, no row layout, no grouping.
  for (const count of [4, 8]) {
    assert.deepEqual(lastCellPresentation(count), { className: STACKED_CELL_CLASS, grouped: false });
  }
});

test('a cell short in BOTH rows stretches and lays its content along the row', () => {
  // Five cells — four facts plus the Reference — is the case reported twice
  // from the live site. First it left a blank filler box beside Reference;
  // then, once Reference stretched, it left the right half of that stretched
  // cell empty, which reads as the same box because the rows above carry a
  // rule at the midpoint. So it stretches AND goes horizontal.
  const five = lastCellPresentation(5);
  assert.equal(five.className, 'col-span-2 sm:col-span-4 flex items-center justify-between gap-4');
  assert.equal(five.grouped, true, 'icon and label must group so the value lands at the far end');

  // Odd is never divisible by four, so an odd count is always short in both.
  for (const count of [1, 3, 5, 7, 9, 11]) {
    const cell = lastCellPresentation(count);
    assert.ok(cell.className.startsWith('col-span-2 '), `${count} cells: no mobile stretch`);
    assert.ok(cell.className.includes('flex items-center'), `${count} cells: not laid along the row`);
    assert.equal(cell.grouped, true);
  }
});

test('a cell exact on mobile but short on desktop stays stacked on the phone', () => {
  // Six cells fill every mobile row (three rows of two) and leave two desktop
  // columns spare. Going horizontal at mobile too would cram an icon, a label
  // and a value like "Petit Boulevard, 2ᵉ Rue Industrielle" onto one line in a
  // half-width cell — listing #293 is exactly that shape.
  const six = lastCellPresentation(6);
  assert.equal(
    six.className,
    'sm:col-span-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
  );
  assert.ok(!six.className.split(' ').includes('col-span-2'), 'must not stretch on mobile');

  // Grouped is still true: the direction flips at `sm` but the DOM cannot, so
  // the icon and label have to be grouped before the flip.
  assert.equal(six.grouped, true);
});

test('every class emitted is a literal Tailwind can actually see', () => {
  // Tailwind v4 scans source text: an interpolated `sm:col-span-${n}` compiles
  // to nothing and the grid silently keeps its hole. This asserts the helper
  // only ever emits classes written out literally in its own source.
  const source = readFileSync(new URL('../../lib/keyFactsGrid.js', import.meta.url), 'utf8');

  for (let count = 1; count <= 24; count += 1) {
    for (const cls of lastCellPresentation(count).className.split(' ').filter(Boolean)) {
      assert.ok(source.includes(`${cls}`), `${cls} is not a literal in lib/keyFactsGrid.js`);
    }
  }
});

test('nonsense in, an ordinary cell out — never a stray span class', () => {
  for (const bad of [0, -1, 2.5, NaN, null, undefined]) {
    assert.deepEqual(lastCellPresentation(bad), { className: STACKED_CELL_CLASS, grouped: false });
  }
});
