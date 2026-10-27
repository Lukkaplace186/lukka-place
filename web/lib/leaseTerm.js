/**
 * Short-term vs long-term rentals (2026-10-21).
 *
 * Some rooms, studios and furnished flats in Kinshasa are let by the day or
 * the week. A rent quoted per day IS the short-term listing, so the fact lives
 * in `properties.price_period` ('jour' | 'semaine' beside 'mois' | 'an' |
 * 'total') — no new column. Long term is the standard and the default: a rent
 * with no period, or a monthly / yearly one.
 *
 * Filter: `?lease_term=short|long` (lib/listings.js buildFilters). Either
 * value implies a rental.
 *
 * Duplicated in the engine's services/leaseTerm.js (CommonJS);
 * tests/unit/lease-term.test.js compares the two. Change one, change the other.
 */

export const SHORT_TERM_PERIODS = ['jour', 'semaine'];
export const LEASE_TERMS = ['short', 'long'];

/** Every period a rent can be quoted in; 'mois' is the default. */
export const RENT_PERIODS = ['mois', 'an', 'jour', 'semaine'];

/** The agent forms' "Durée de location" select. */
export const RENT_PERIOD_OPTIONS = [
  { value: 'mois', labelKey: 'agent.editor.rentPeriod.mois' },
  { value: 'jour', labelKey: 'agent.editor.rentPeriod.jour' },
  { value: 'semaine', labelKey: 'agent.editor.rentPeriod.semaine' },
  { value: 'an', labelKey: 'agent.editor.rentPeriod.an' },
];

/** A rent's period from a form: one of RENT_PERIODS, else null. */
export function normaliseRentPeriod(value) {
  return RENT_PERIODS.includes(value) ? value : null;
}

/** The search bar's options, in display order ('' = no constraint). */
export const LEASE_TERM_OPTIONS = [
  { value: '', labelKey: 'listings.leaseTerm.any' },
  { value: 'long', labelKey: 'listings.leaseTerm.long' },
  { value: 'short', labelKey: 'listings.leaseTerm.short' },
];

/** SQL: a rent priced per day or per week. `alias` is the properties alias. */
export function shortTermSql(alias = 'p') {
  return `(${alias}.purpose = 'rent' AND ${alias}.price_period IN ('jour', 'semaine'))`;
}

/** SQL: a rent that is not short term — no period counts as monthly. */
export function longTermSql(alias = 'p') {
  return `(${alias}.purpose = 'rent' AND COALESCE(${alias}.price_period, 'mois') NOT IN ('jour', 'semaine'))`;
}

export function isShortTermPeriod(period) {
  return SHORT_TERM_PERIODS.includes(period);
}

export function normaliseLeaseTerm(value) {
  return LEASE_TERMS.includes(value) ? value : null;
}

/** "/ jour", "/ semaine", "/ an", "/ mois" for a rent. */
export function rentPeriodLabel(period) {
  if (period === 'jour') return '/ jour';
  if (period === 'semaine') return '/ semaine';
  if (period === 'an') return '/ an';
  return '/ mois';
}

/**
 * A rent as a monthly figure, for medians and budget comparisons: yearly ÷ 12,
 * short term → null (a nightly price is not a monthly one and is left out
 * rather than multiplied by a guessed occupancy).
 */
export function monthlyEquivalent(price, purpose, period) {
  if (purpose !== 'rent') return price;
  if (isShortTermPeriod(period)) return null;
  return period === 'an' ? price / 12 : price;
}
