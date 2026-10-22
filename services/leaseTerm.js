'use strict';

/**
 * Short-term vs long-term rentals (2026-10-21).
 *
 * In Kinshasa some rooms, studios and furnished flats are let by the day or
 * the week. That is not a separate column: a rent quoted "par jour" IS the
 * short-term listing, so the fact lives where the price's own unit already
 * lives, `price_period` ('jour' | 'semaine' beside 'mois' | 'an' | 'total').
 * Long term is the standard and the default — a rent with no period, or a
 * monthly / yearly one.
 *
 * Duplicated in web/lib/leaseTerm.js (ESM); web's lease-term test compares
 * the two. Change one, change the other.
 */

const SHORT_TERM_PERIODS = ['jour', 'semaine'];
const LEASE_TERMS = ['short', 'long'];

/** SQL: a rent priced per day or per week. `alias` is the properties alias. */
function shortTermSql(alias = 'p') {
  return `(${alias}.purpose = 'rent' AND ${alias}.price_period IN ('jour', 'semaine'))`;
}

/** SQL: a rent that is not short term — no period counts as monthly. */
function longTermSql(alias = 'p') {
  return `(${alias}.purpose = 'rent' AND COALESCE(${alias}.price_period, 'mois') NOT IN ('jour', 'semaine'))`;
}

function isShortTermPeriod(period) {
  return SHORT_TERM_PERIODS.includes(period);
}

/** " / jour", " / semaine", " / an", " / mois" — '' for a sale or a total. */
function periodSuffix(period, { sale = false } = {}) {
  if (sale || period === 'total') return '';
  if (period === 'jour') return ' / jour';
  if (period === 'semaine') return ' / semaine';
  if (period === 'an') return ' / an';
  return ' / mois';
}

function normaliseLeaseTerm(value) {
  return LEASE_TERMS.includes(value) ? value : null;
}

module.exports = {
  SHORT_TERM_PERIODS,
  LEASE_TERMS,
  shortTermSql,
  longTermSql,
  isShortTermPeriod,
  periodSuffix,
  normaliseLeaseTerm,
};
