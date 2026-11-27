/**
 * Budget chips under the rental search bar (2026-11-25).
 *
 * Why: the Facebook ads land on /listings "everything up to $750–900", whose
 * first cards cost $500+, while the median budget visitors pick is $350 and
 * the listings at $300 or less (13 % of rentals) drew 47 % of the people who
 * tapped WhatsApp (production, 30 days to 2026-11-25). Of 16,545 ad visitors
 * in 7 days, 4.2 % opened a listing. One tap now narrows the feed to what
 * they can pay.
 *
 * Each chip sets price_min / price_max (the URL the search already reads), so
 * its use is measured by page_views.query like any other search; tapping the
 * chip that is on clears both. Monthly rents only: hidden on a sale and on a
 * short stay (prices per day / week).
 *
 * Pure, so the rules are testable (tests/unit/budget-chips.test.js).
 */
export const BUDGET_CHIPS = [
  { key: 'under200', min: '', max: '200' },
  { key: 'from200to400', min: '200', max: '400' },
  { key: 'from400to750', min: '400', max: '750' },
];

/** The chip matching the current price filter exactly, or null. */
export function activeBudgetChip(priceMin, priceMax) {
  const min = String(priceMin || '');
  const max = String(priceMax || '');
  return BUDGET_CHIPS.find((c) => c.min === min && c.max === max) || null;
}

/** What tapping a chip sets: its range, or nothing when it was already on. */
export function budgetChipToggle(chip, priceMin, priceMax) {
  const on = activeBudgetChip(priceMin, priceMax)?.key === chip.key;
  return on ? { min: '', max: '' } : { min: chip.min, max: chip.max };
}

/** Shown on a monthly rental search only. */
export function showBudgetChips(transaction, leaseTerm) {
  return transaction !== 'vente' && leaseTerm !== 'short';
}
