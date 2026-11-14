/**
 * Demo account numbers — the pure half, twin of the engine's
 * services/demoAccounts.js (verify-pipeline compares the two; change one,
 * change the other).
 *
 * 243 0000 + 5 digits: no DRC mobile number starts 2430 (they are 243 8x… /
 * 243 9x…), so a number of this shape can never belong to anyone. The agent of
 * pair N is 2430000 1NNNN, its customer 2430000 2NNNN.
 */

export const DEMO_PHONE_PREFIX = '2430000';
export const DEMO_PHONE_PATTERN = /^2430000\d{5}$/;

export function isDemoPhone(value) {
  return DEMO_PHONE_PATTERN.test(String(value ?? '').replace(/\D/g, ''));
}

export function demoPhonesFor(pairId) {
  const n = Number(pairId);
  if (!Number.isSafeInteger(n) || n < 1 || n > 9999) throw new Error('demo pair id must be 1-9999');
  const suffix = String(n).padStart(4, '0');
  return { agentPhone: `${DEMO_PHONE_PREFIX}1${suffix}`, customerPhone: `${DEMO_PHONE_PREFIX}2${suffix}` };
}

/** SQL condition excluding demo agents, for an `agents` alias. */
export function notDemoAgentSql(alias = 'a') {
  return `COALESCE(${alias}.phone, '') NOT LIKE '${DEMO_PHONE_PREFIX}%'`;
}

/** SQL condition excluding demo customers, for a `customers` alias. */
export function notDemoCustomerSql(alias = 'c') {
  return `COALESCE(${alias}.phone, '') NOT LIKE '${DEMO_PHONE_PREFIX}%'`;
}

/** The cookie that marks a browser playing a demo pair (banner, engine header, analytics). */
export const DEMO_COOKIE = 'lukka_demo';
