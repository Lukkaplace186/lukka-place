/**
 * MaishaPay — the pure half: phone format, operator codes, references, and
 * how a MaishaPay answer is read. lib/maishapay.js does the HTTP,
 * lib/payments.js the database. tests/unit/maishapay.test.js pins every rule.
 *
 * SOURCE OF THE API SHAPE: MaishaPay's own REST API documentation (Postman
 * "Maishapay REST API DOC", published id 2sAYQXnCU4, read 2026-11-25), then
 * checked against the sandbox with real calls the same day:
 *   POST {base}/collect/v2/store/mobileMoney
 *        {transactionReference, gatewayMode, publicApiKey, secretApiKey,
 *         order: {amount, currency, customerFullName?, customerEmailAdress?},
 *         paymentChannel: {channel: 'MOBILEMONEY', provider, walletID: '+243…', callbackUrl}}
 *        → {status_code: 202, transactionStatus: 'PENDING', transactionId, originatingTransactionId, order: {cost}}
 *          (the sandbox answers 200 SUCCESS at once)
 *        → error {status_code: 400, title: 'WalletID error', errors: {message}} when the
 *          number is not on that operator; title 'Provider not found' for an unknown code.
 *   POST {base}/transaction/rest/v2/check?useRef=1  {gatewayMode, publicApiKey, secretApiKey, transactionId: <our reference>}
 *        → {transaction_type: 'C2B | Collect', status_code, transactionStatus: SUCCESS|FAILED|PENDING,
 *           transactionId, originatingTransactionId, order: {cost: {amount, frais, total, currency}}}
 *        → [] for a reference MaishaPay does not know.
 * The doc's v2 table names only Orange and Airtel for the DRC, but the
 * sandbox takes MPESA on v2 too (it checks the number is Vodacom), so the
 * synchronous v1 M-Pesa endpoint is not used.
 * `cost.amount` is the price before MaishaPay's fee (`frais`, 3.5 % in the
 * sandbox), `total` what the payer is charged.
 */

/** Our operator ids (checkout radio values) → MaishaPay's `provider` codes. */
export const MAISHAPAY_PROVIDERS = { mpesa: 'MPESA', orange: 'ORANGE', airtel: 'AIRTEL' };

export const MAISHAPAY_CURRENCIES = ['USD', 'CDF'];

/** The operator's MaishaPay code, or null for anything else. */
export function maishapayProvider(operatorId) {
  return MAISHAPAY_PROVIDERS[String(operatorId ?? '').toLowerCase()] || null;
}

/**
 * A Congolese mobile-money number as stored: 243 + 9 digits.
 * Accepts "0812345678", "812345678", "+243 81 234 5678", "00243…".
 * Anything else (another country, a landline length) is null — mobile money
 * only exists on a DRC number.
 */
export function normaliseMobileMoneyPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `243${digits.slice(1)}`;
  if (digits.length === 9) digits = `243${digits}`;
  return /^243[89]\d{8}$/.test(digits) ? digits : null;
}

/** MaishaPay's walletID: the stored number in international format, "+243…". */
export function walletId(storedPhone) {
  const digits = normaliseMobileMoneyPhone(storedPhone);
  return digits ? `+${digits}` : null;
}

/** Our invoice reference, MaishaPay's transactionReference: LP-<year>-<invoice id>-<4 random hex>. */
export function invoiceReference(invoiceId, year, randomHex) {
  return `LP-${year}-${invoiceId}-${String(randomHex).slice(0, 4).toUpperCase()}`;
}

/**
 * Live keys start MP-LIVE…, sandbox keys MP-SB…. The mode is set explicitly
 * (MAISHAPAY_MODE) and both keys must agree with it, so sandbox keys can
 * never be mistaken for live ones, nor the reverse.
 * @returns {0|1|null} MaishaPay's gatewayMode, or null when they disagree
 */
export function gatewayModeFor(mode, publicKey, secretKey) {
  const m = String(mode ?? '').trim().toLowerCase();
  const prefix = m === 'live' ? 'MP-LIVE' : m === 'sandbox' ? 'MP-SB' : null;
  if (!prefix || !publicKey || !secretKey) return null;
  if (!String(publicKey).startsWith(prefix) || !String(secretKey).startsWith(prefix)) return null;
  return m === 'live' ? 1 : 0;
}

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * What MaishaPay answered to a collection request. `state` is only a hint for
 * the page — an invoice is marked paid from a status check, never from this.
 * @returns {{ok: true, transactionId: string|null, state: 'pending'|'paid'|'failed'}
 *         | {ok: false, error: 'wallet'|'provider', message: string}}
 */
export function readInitiateResponse(httpStatus, body) {
  const title = String(body?.title ?? '');
  const message = String(body?.errors?.message ?? body?.message ?? title ?? '').slice(0, 300);
  if (/wallet\s*id/i.test(title)) return { ok: false, error: 'wallet', message: message || 'WalletID error' };
  const status = upper(body?.transactionStatus);
  const okHttp = httpStatus >= 200 && httpStatus < 300;
  if (!okHttp || !['PENDING', 'SUCCESS', 'FAILED'].includes(status)) {
    return { ok: false, error: 'provider', message: message || `HTTP ${httpStatus}` };
  }
  const transactionId = body?.transactionId == null ? null : String(body.transactionId);
  if (status === 'FAILED') return { ok: true, transactionId, state: 'failed' };
  return { ok: true, transactionId, state: status === 'SUCCESS' ? 'paid' : 'pending' };
}

/**
 * The verdict on one invoice from a status check. Only this — never the
 * callback body, which carries no signature — can mark an invoice paid, and
 * only when MaishaPay's record is ours (same reference), a collection, and
 * its amount and currency cover the invoice.
 * @param {object|Array} body the /transaction/rest/v2/check?useRef=1 answer
 * @param {{amount: number|string, currency: string, reference: string}} invoice
 * @returns {{state: 'paid'|'failed'|'pending'|'mismatch', reason?: string, transactionId?: string}}
 */
export function readCheckResponse(body, invoice) {
  const tx = Array.isArray(body) ? body[0] : body;
  if (!tx || typeof tx !== 'object') return { state: 'pending', reason: 'transaction inconnue de MaishaPay' };
  const status = upper(tx.transactionStatus);
  if (!status) return { state: 'pending', reason: 'pas de statut' };
  if (tx.originatingTransactionId != null && String(tx.originatingTransactionId) !== String(invoice.reference)) {
    return { state: 'mismatch', reason: 'référence différente' };
  }
  if (tx.transaction_type != null && !/collect|c2b/i.test(String(tx.transaction_type))) {
    return { state: 'mismatch', reason: `type ${tx.transaction_type}` };
  }
  const transactionId = tx.transactionId == null ? undefined : String(tx.transactionId);
  if (status === 'FAILED') return { state: 'failed', reason: String(tx.message || 'paiement échoué').slice(0, 300), transactionId };
  if (status !== 'SUCCESS') return { state: 'pending', reason: `statut ${status}`, transactionId };
  const cost = tx.order?.cost ?? tx.cost ?? {};
  const paidAmount = Number(cost.amount);
  const paidCurrency = upper(cost.currency);
  if (!Number.isFinite(paidAmount) || paidAmount + 0.005 < Number(invoice.amount)) return { state: 'mismatch', reason: 'montant inférieur à la facture', transactionId };
  if (paidCurrency !== upper(invoice.currency)) return { state: 'mismatch', reason: 'devise différente', transactionId };
  return { state: 'paid', transactionId };
}

/** What goes into payment_logs: never a key, token or Authorization header. */
export function redactForLog(value) {
  if (value == null || typeof value !== 'object') return value ?? null;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, v] of Object.entries(value)) {
    if (/token|authorization|api[_-]?key|secret|password/i.test(key)) continue;
    out[key] = v && typeof v === 'object' ? redactForLog(v) : v;
  }
  return out;
}
