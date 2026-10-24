/**
 * Price steps for the homepage search card's Budget Min / Max dropdowns.
 *
 * Rent steps are the owner's list (2026-10-24): $100 steps to $1,000, then
 * 1,250 / 1,500 / 2,000 / 2,500 / 3,000 / 4,000, then every $1,000 to
 * $10,000, then "10 000 $ +". A sale has its own scale — a $10k ceiling
 * means nothing for a $380,000 house.
 *
 * "10 000 $ +" is the top of the list on both sides. As a minimum it is the
 * figure itself (10 000 and more). As a maximum it means "no ceiling", so it
 * carries its own value (OVER) and sends no price_max at all: a max of
 * 10 000 would hide the listings the label promises.
 *
 * Pure, so the rules are testable (tests/unit/budget-steps.test.js).
 */
export const RENT_BUDGET_STEPS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
  1250, 1500, 2000, 2500, 3000, 4000,
  5000, 6000, 7000, 8000, 9000, 10000,
];

export const SALE_BUDGET_STEPS = [
  10000, 25000, 50000, 75000, 100000, 150000, 200000, 300000,
  400000, 500000, 750000, 1000000,
];

/** The "N $ +" option's value in the Max dropdown: no ceiling. */
export const OVER = 'over';

export function budgetSteps(transactionType) {
  return transactionType === 'sale' ? SALE_BUDGET_STEPS : RENT_BUDGET_STEPS;
}

/**
 * The price_min / price_max the two dropdowns stand for. '' is "not set".
 * A min above the max is not sent as a contradiction: the max is dropped.
 */
export function budgetParams(min, max) {
  const lo = min === '' || min == null ? null : Number(min);
  const hi = max === '' || max == null || max === OVER ? null : Number(max);
  return {
    price_min: lo != null && Number.isFinite(lo) ? String(lo) : '',
    price_max: hi != null && Number.isFinite(hi) && (lo == null || hi >= lo) ? String(hi) : '',
  };
}

/**
 * Options for both dropdowns. `format(amount)` renders a figure in the
 * reader's language ("1 500", "1,500"); `labels` holds the translated words:
 * { minAny, maxAny, min(amount), max(amount), over(amount) }.
 * A max option below the chosen min (and a min above the chosen max) is
 * disabled rather than hidden, so the list does not jump while scrolling.
 */
export function budgetOptions(transactionType, { min = '', max = '' } = {}, format, labels) {
  const steps = budgetSteps(transactionType);
  const top = steps[steps.length - 1];
  const lo = min === '' ? null : Number(min);
  const hi = max === '' || max === OVER ? null : Number(max);

  const minOptions = [
    { value: '', label: labels.minAny },
    ...steps.map((amount) => ({
      value: String(amount),
      label: amount === top ? labels.over(format(amount)) : labels.min(format(amount)),
      disabled: hi != null && amount > hi,
    })),
  ];
  const maxOptions = [
    { value: '', label: labels.maxAny },
    ...steps.map((amount) => ({
      value: String(amount),
      label: labels.max(format(amount)),
      disabled: lo != null && amount < lo,
    })),
    { value: OVER, label: labels.over(format(top)) },
  ];
  return { minOptions, maxOptions };
}
