/**
 * The move-in cost behind "3 + 1 + 1" — pure, shared by the guide's
 * calculator (components/blog/DepositCalculator.js) and its tests.
 *
 * Three separate payments, never summed into one "deposit" (root CLAUDE.md,
 * "Listing fields that must not be conflated"):
 *   - garantie (deposit): refundable at the end of the lease;
 *   - avance: rent paid up front. The first month is the rent for the month
 *     the tenant moves in; any month beyond it is advance rent;
 *   - commission: the agent's fee.
 *
 * The legal ceiling is Loi n° 15/025 du 31 décembre 2015 (baux à loyer non
 * professionnels), residential lease:
 *   - art. 18: garantie at most 3 months;
 *   - art. 22: the landlord may not demand rent in advance, so nothing beyond
 *     the first month's rent;
 *   - art. 10: the agency fee is one month's rent (split when the same agency
 *     acts for both sides, which only lowers it).
 */

export const LEGAL_MAX = Object.freeze({ deposit: 3, advance: 1, commission: 1 });

/** Stepper bounds and steps, in months. Commission moves by half months. */
export const MONTH_LIMITS = Object.freeze({
  deposit: { min: 0, max: 24, step: 1 },
  advance: { min: 0, max: 12, step: 1 },
  commission: { min: 0, max: 3, step: 0.5 },
});

/** Presets the reader can tap: deposit + advance + commission, in months. */
export const DEPOSIT_PRESETS = Object.freeze([
  [3, 1, 1],
  [6, 1, 1],
  [10, 2, 1],
  [12, 3, 1],
]);

/** A months value clamped to its bounds and snapped to its step. */
export function clampMonths(kind, value) {
  const { min, max, step } = MONTH_LIMITS[kind];
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  const snapped = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/**
 * What is asked and what the law allows, in the rent's own currency.
 * `rent` is the monthly rent (> 0); months are clamped. Returns null for a
 * rent that is not a positive number — there is nothing to compute.
 */
export function moveInCost({ rent, deposit, advance, commission }) {
  const r = Number(rent);
  if (!Number.isFinite(r) || r <= 0) return null;
  const g = clampMonths('deposit', deposit);
  const a = clampMonths('advance', advance);
  const c = clampMonths('commission', commission);

  const firstMonth = Math.min(a, 1);
  const asked = {
    deposit: g * r,
    firstMonth: firstMonth * r,
    extraAdvance: Math.max(0, a - 1) * r,
    commission: c * r,
  };
  const legal = {
    deposit: Math.min(g, LEGAL_MAX.deposit) * r,
    firstMonth: firstMonth * r,
    extraAdvance: 0,
    commission: Math.min(c, LEGAL_MAX.commission) * r,
  };
  const total = (o) => o.deposit + o.firstMonth + o.extraAdvance + o.commission;
  const askedTotal = total(asked);
  const legalTotal = total(legal);
  return {
    months: { deposit: g, advance: a, commission: c },
    asked,
    legal,
    askedTotal,
    legalTotal,
    excess: askedTotal - legalTotal,
    excessMonths: (askedTotal - legalTotal) / r,
    refundable: asked.deposit,
    over: {
      deposit: g > LEGAL_MAX.deposit,
      extraAdvance: a > LEGAL_MAX.advance,
      commission: c > LEGAL_MAX.commission,
    },
  };
}

/** The `guides.calculator.*` keys the calculator renders (resolved server-side). */
export const CALCULATOR_LABEL_KEYS = Object.freeze([
  'title', 'subtitle', 'rentLabel', 'examples', 'currencyLabel', 'rateNote', 'askedLabel', 'presets',
  'deposit', 'advance', 'commission', 'less', 'more', 'askedTotal', 'legalTotal', 'monthsOfRent',
  'refundable', 'excess', 'withinLaw', 'enterRent', 'barAsked', 'barLaw', 'colItem', 'colAsked', 'colLaw',
  'rowDeposit', 'rowDepositSub', 'rowFirst', 'rowFirstSub', 'rowExtra', 'rowExtraSub', 'rowCommission',
  'rowCommissionSub', 'rowTotal', 'tagRefundable', 'tagNotRefundable', 'tagOverLaw', 'footnote',
]);
