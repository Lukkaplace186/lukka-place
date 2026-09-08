import test from 'node:test';
import assert from 'node:assert/strict';
import { entryTerms } from '@/lib/listingView';
import { lastCellSpanClass } from '@/lib/keyFactsGrid';

/**
 * The listing detail page's KeyFacts grid, in the two places it can be wrong
 * without anyone noticing: what it says about money, and what it leaves behind
 * when the last row is short.
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

test('a full row leaves the last cell exactly one column wide', () => {
  // 4 cells fill both a 2-up and a 4-up row; 8 does the same.
  assert.equal(lastCellSpanClass(4), '');
  assert.equal(lastCellSpanClass(8), '');
});

test('a short final row is closed by the last real cell, never by a blank one', () => {
  // Five cells — four facts plus the Reference — is the case that produced a
  // blank white box beside Reference on a phone. The cell stretches instead.
  assert.equal(lastCellSpanClass(5), 'col-span-2 sm:col-span-4');

  // Six: exact on mobile (three full rows of two), two columns spare on
  // desktop. The two breakpoints genuinely disagree, which is why both are
  // computed rather than one being derived from the other.
  assert.equal(lastCellSpanClass(6), 'sm:col-span-3');

  assert.equal(lastCellSpanClass(7), 'col-span-2 sm:col-span-2');
  assert.equal(lastCellSpanClass(3), 'col-span-2 sm:col-span-2');
  assert.equal(lastCellSpanClass(2), 'sm:col-span-3');
  assert.equal(lastCellSpanClass(1), 'col-span-2 sm:col-span-4');
});

test('every span class is a literal Tailwind can actually see', () => {
  // Tailwind v4 scans source text: an interpolated `sm:col-span-${n}` compiles
  // to nothing and the grid silently keeps its hole. This asserts the helper
  // only ever emits from the fixed set written out in its source.
  const allowed = new Set(['col-span-2', 'sm:col-span-2', 'sm:col-span-3', 'sm:col-span-4']);

  for (let count = 1; count <= 24; count += 1) {
    for (const cls of lastCellSpanClass(count).split(' ').filter(Boolean)) {
      assert.ok(allowed.has(cls), `${cls} is not one of the literals in lib/keyFactsGrid.js`);
    }
  }

  // Nonsense in, nothing out — never a stray class on a grid with no cells.
  for (const bad of [0, -1, 2.5, NaN, null, undefined]) {
    assert.equal(lastCellSpanClass(bad), '');
  }
});
