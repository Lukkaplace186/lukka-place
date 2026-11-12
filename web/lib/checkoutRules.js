/**
 * The agent plan checkout (/compte/agent/abonnement/paiement), its pure half.
 * The page, the client form and tests/unit/agent-checkout.test.js share it.
 *
 * What the checkout offers is what lib/payments.js can actually do:
 *   - FlexPaie mobile money only (`type` 1). FlexPaie routes the prompt by the
 *     number, so the operator choice tells the agent what to expect on their
 *     phone; it is not sent anywhere. Card (FlexPaie `type` 2) is not built,
 *     so it is not offered.
 *   - One payment per period, never an automatic monthly debit: FlexPaie's
 *     push payment has no mandate, so "Abonnement automatique" from the design
 *     would be a promise nothing keeps.
 *   - The price is the `packages` row's own price, in USD (same as
 *     startFlexpaiePayment). Nothing on this page invents a figure.
 */

/** The three DRC mobile-money networks, in the design's order. */
export const MOBILE_MONEY_OPERATORS = [
  { id: 'mpesa', label: 'M-Pesa', network: 'Vodacom' },
  { id: 'orange', label: 'Orange Money', network: 'Orange' },
  { id: 'airtel', label: 'Airtel Money', network: 'Airtel' },
];

export const DEFAULT_OPERATOR = MOBILE_MONEY_OPERATORS[0].id;

export function operatorById(id) {
  return MOBILE_MONEY_OPERATORS.find((o) => o.id === id) || MOBILE_MONEY_OPERATORS[0];
}

/**
 * The plan to check out, or null when it cannot be paid online: unknown id,
 * a trial, or a free plan (startFlexpaiePayment refuses the same ones).
 * @param {Array<{id: number, price: number, is_trial?: number|boolean}>} packages getPurchasablePackages()
 * @param {string|number|undefined} rawId the `forfait` query parameter
 */
export function payablePackage(packages, rawId) {
  const id = Number.parseInt(String(rawId ?? ''), 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const pkg = (packages || []).find((p) => Number(p.id) === id);
  if (!pkg || Number(pkg.is_trial) || !(Number(pkg.price) > 0)) return null;
  return pkg;
}

/** Whether a plan card gets the "Payer" button rather than a request. */
export function isPayableOnline(pkg) {
  return Boolean(pkg) && !Number(pkg.is_trial) && Number(pkg.price) > 0;
}

/** Prices in French format, "1 100 $" (brand rule), with a normal space. */
export function formatUsd(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/ | /g, ' ')} $`;
}

export function checkoutPath(packageId) {
  return `/compte/agent/abonnement/paiement?forfait=${encodeURIComponent(packageId)}`;
}

/** What the initiate route's error codes mean to the agent (i18n keys under agent.checkout.errors). */
export function initiateErrorKey(code) {
  switch (code) {
    case 'phone': return 'agent.checkout.errors.phone';
    case 'no_agency': return 'agent.checkout.errors.noAgency';
    case 'package': return 'agent.checkout.errors.package';
    case 'not_configured': return 'agent.checkout.errors.notConfigured';
    case 'provider': return 'agent.checkout.errors.provider';
    case 'auth': return 'agent.checkout.errors.auth';
    default: return 'agent.checkout.errors.generic';
  }
}

/** Poll the status route this often while the phone prompt is open, and stop after this long. */
export const STATUS_POLL_MS = 4000;
export const STATUS_POLL_LIMIT_MS = 5 * 60 * 1000;
