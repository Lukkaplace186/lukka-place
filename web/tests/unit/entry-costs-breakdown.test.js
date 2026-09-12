import test from 'node:test';
import assert from 'node:assert/strict';
import { entryCostBreakdown } from '@/lib/listingView';
import { formatPriceParts } from '@/lib/format';

/**
 * "3 + 1 + 1" is complete information for an agent and nearly none for a
 * tenant. Five months of rent is a large number, and nothing on the page used
 * to say which part comes back and which part is the agency's fee.
 *
 * Every number here is money a real person is asked to hand over, so the rules
 * are tested directly rather than left to the component.
 */

const rental = (extra = {}) => ({
  price: 1000,
  price_period: 'mois',
  currency: 'USD',
  purpose: 'rent',
  deposit_months: 3,
  advance_months: 1,
  commission_months: 1,
  ...extra,
});

test('each poste is attributed to whoever actually receives it', () => {
  const { lines } = entryCostBreakdown(rental());
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));

  assert.equal(byKey.deposit.recipient, 'bailleur');
  assert.equal(byKey.advance.recipient, 'bailleur');
  assert.equal(byKey.commission.recipient, 'agent');
});

test('only the guarantee is marked refundable', () => {
  const { lines } = entryCostBreakdown(rental());
  const refundable = lines.filter((l) => l.refundable).map((l) => l.key);
  // Prepaid rent is spent, not returned; commission is a fee. Marking either
  // refundable would promise a tenant money back that nobody owes them.
  assert.deepEqual(refundable, ['deposit']);
});

test('amounts are each poste times the monthly rent, and the total is their sum', () => {
  const { lines, totalMonths, totalAmount } = entryCostBreakdown(rental());
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));

  assert.equal(byKey.deposit.amount, 3000);
  assert.equal(byKey.advance.amount, 1000);
  assert.equal(byKey.commission.amount, 1000);
  assert.equal(totalMonths, 5);
  assert.equal(totalAmount, 5000);
  // Derived, never stored — so it cannot drift from its parts.
  assert.equal(totalAmount, lines.reduce((sum, l) => sum + l.amount, 0));
});

test('display order matches the "3 + 1 + 1" notation shown elsewhere on the page', () => {
  // Position and number must agree wherever a reader looks; a breakdown
  // ordered differently from the notation invites reading the wrong figure.
  const { lines } = entryCostBreakdown(rental());
  assert.deepEqual(lines.map((l) => l.key), ['deposit', 'advance', 'commission']);
});

test('a two-term listing ("4+1") renders both and no invented commission', () => {
  const { lines, totalMonths } = entryCostBreakdown(
    rental({ deposit_months: 4, advance_months: 1, commission_months: null }),
  );
  assert.deepEqual(lines.map((l) => l.key), ['deposit', 'advance']);
  assert.equal(totalMonths, 5);
});

test('a listing stating only a guarantee renders nothing at all', () => {
  // Inventing the "+ 1 + 1" that usually follows would be inventing money
  // someone would budget for.
  assert.equal(
    entryCostBreakdown(rental({ advance_months: null, commission_months: null })),
    null,
  );
  assert.equal(entryCostBreakdown(rental({ deposit_months: null })), null);
});

test('a SALE listing gets months but never amounts', () => {
  // A sale price multiplied by five months is a number nobody owes.
  const sale = entryCostBreakdown(
    rental({ purpose: 'sale', price_period: 'total', price: 250000 }),
  );
  assert.equal(sale.hasAmounts, false);
  assert.equal(sale.totalAmount, null);
  assert.equal(sale.totalMonths, 5);
  for (const line of sale.lines) assert.equal(line.amount, null);
});

test('a rental with no usable price still states the months', () => {
  const noPrice = entryCostBreakdown(rental({ price: null }));
  assert.equal(noPrice.hasAmounts, false);
  assert.equal(noPrice.totalMonths, 5);
  assert.equal(noPrice.lines.length, 3);
});

test('zero is kept as a real answer, distinct from "not stated"', () => {
  // 0 = "no commission required" is a claim; null = we were never told.
  const zeroCommission = entryCostBreakdown(rental({ commission_months: 0 }));
  const byKey = Object.fromEntries(zeroCommission.lines.map((l) => [l.key, l]));
  assert.equal(byKey.commission.months, 0);
  assert.equal(byKey.commission.amount, 0);
  assert.equal(zeroCommission.totalMonths, 4);
});

test('months arriving as numeric strings are still arithmetic', () => {
  const stringy = entryCostBreakdown(rental({ deposit_months: '3', advance_months: '1' }));
  assert.equal(stringy.totalMonths, 5);
  assert.equal(stringy.totalAmount, 5000);
});

test('every figure tracks the rent at any price point — the live listings', () => {
  // The shapes and prices of real approved listings (#297, #296, #303, and a
  // 6 + 1 + 1 at the top of the range), so the card is checked against what
  // it actually renders rather than one round number.
  const cases = [
    { price: 750, terms: [3, 1, 1], amounts: [2250, 750, 750], total: 3750, months: 5 },
    { price: 1100, terms: [3, 1, 1], amounts: [3300, 1100, 1100], total: 5500, months: 5 },
    { price: 300, terms: [4, 1, null], amounts: [1200, 300], total: 1500, months: 5 },
    { price: 2500, terms: [6, 1, 1], amounts: [15000, 2500, 2500], total: 20000, months: 8 },
  ];

  for (const { price, terms, amounts, total, months } of cases) {
    const [deposit_months, advance_months, commission_months] = terms;
    const b = entryCostBreakdown(rental({ price, deposit_months, advance_months, commission_months }));
    assert.deepEqual(b.lines.map((l) => l.amount), amounts, `${price} $ × ${terms.join('+')}`);
    assert.equal(b.totalAmount, total);
    assert.equal(b.totalMonths, months);
    // The formula badge is the stated parts and nothing else — "4 + 1" stays
    // two terms, never padded to "4 + 1 + 1".
    assert.equal(b.lines.map((l) => l.months).join(' + '), terms.filter((m) => m !== null).join(' + '));
  }
});

test('no default advance or commission is ever filled in', () => {
  // #305 on the live site: "Garantie : 4 mois", nothing else. A "+ 1 + 1"
  // default would put 2 000 $ on its card that nobody asked for.
  assert.equal(entryCostBreakdown(rental({ price: 1000, deposit_months: 4, advance_months: null, commission_months: null })), null);
});

test('entry-cost amounts are formatted WITHOUT a "/ mois" suffix', () => {
  // These are one-off sums due once at signing. formatPriceParts appends
  // "/ mois" for any rental whatever period is passed, so the component must
  // format them as non-recurring — "1 500 $ / mois" on the total reads as a
  // monthly charge five times the actual rent, which is what shipped once.
  assert.equal(formatPriceParts(1500, 'rent', 'total').period, '/ mois');
  assert.equal(formatPriceParts(1500, 'oneOff').period, null);
  assert.equal(formatPriceParts(1500, 'oneOff').amount, '1 500 $');
});
