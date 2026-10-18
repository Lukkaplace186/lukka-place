/**
 * FlexPaie (FlexPay DRC) — the pure half: phone format, references, and how
 * a FlexPaie answer is read. lib/flexpaie.js does the HTTP, lib/payments.js
 * the database. tests/unit/flexpaie.test.js pins every rule here.
 *
 * SOURCE OF THE API SHAPE — read before going live. No official FlexPaie
 * document was available when this was written (2026-10-18). Field names
 * and codes come from the community SDK's documentation (pyflexpay):
 *   POST {base}/paymentService  {merchant, type, reference, phone, amount, currency, callbackUrl}
 *        → {code, message, orderNumber}           code "0" = request received
 *   GET  {base}/check/{orderNumber}
 *        → {code, message, transaction: {reference, orderNumber, status, amount, currency, …}}
 *                                                 status "0" = success, "1" = failed
 *   Authorization: Bearer <token>
 * Anything else is read as "still pending", never as paid. Confirm each of
 * these against FlexPaie's merchant documentation with a sandbox payment
 * before setting FLEXPAIE_API_KEY in production.
 */

export const FLEXPAIE_CURRENCIES = ['USD', 'CDF'];

/** FlexPaie's `type`: 1 = mobile money (the only one offered here), 2 = card. */
export const FLEXPAIE_TYPE_MOBILE_MONEY = 1;

/**
 * A Congolese mobile-money number as FlexPaie expects it: 243 + 9 digits.
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

/** Our invoice reference, echoed by FlexPaie: LP-<year>-<invoice id>-<4 random hex>. */
export function invoiceReference(invoiceId, year, randomHex) {
  return `LP-${year}-${invoiceId}-${String(randomHex).slice(0, 4).toUpperCase()}`;
}

/** @returns {{ok: true, orderNumber: string} | {ok: false, message: string}} */
export function readInitiateResponse(body) {
  const code = body?.code ?? body?.Code;
  const orderNumber = body?.orderNumber ?? body?.OrderNumber;
  if (String(code) === '0' && orderNumber) return { ok: true, orderNumber: String(orderNumber) };
  return { ok: false, message: String(body?.message ?? body?.Message ?? 'FlexPaie a refusé la demande').slice(0, 300) };
}

/**
 * The verdict on one invoice from a status check. Only a check — never the
 * callback body, which anyone can post — can mark an invoice paid, and only
 * when the amount and currency FlexPaie reports cover what was invoiced.
 * @param {object} body the GET /check answer
 * @param {{amount: number|string, currency: string, reference: string}} invoice
 * @returns {{state: 'paid'|'failed'|'pending'|'mismatch', reason?: string}}
 */
export function readCheckResponse(body, invoice) {
  if (String(body?.code ?? body?.Code) !== '0') return { state: 'pending', reason: 'check not received' };
  const tx = body?.transaction ?? body?.Transaction;
  if (!tx || typeof tx !== 'object') return { state: 'pending', reason: 'no transaction' };
  if (tx.reference != null && String(tx.reference) !== String(invoice.reference)) {
    return { state: 'mismatch', reason: 'reference differs' };
  }
  const status = String(tx.status ?? '');
  if (status === '1') return { state: 'failed', reason: String(body?.message ?? 'paiement échoué').slice(0, 300) };
  if (status !== '0') return { state: 'pending', reason: `status ${status || 'absent'}` };
  const paidAmount = Number(tx.amount);
  const paidCurrency = String(tx.currency ?? '').toUpperCase();
  if (!Number.isFinite(paidAmount) || paidAmount + 0.005 < Number(invoice.amount)) return { state: 'mismatch', reason: 'amount below invoice' };
  if (paidCurrency && paidCurrency !== String(invoice.currency).toUpperCase()) return { state: 'mismatch', reason: 'currency differs' };
  return { state: 'paid' };
}

/** What goes into payment_logs: never a token, key or Authorization header. */
export function redactForLog(value) {
  if (value == null || typeof value !== 'object') return value ?? null;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, v] of Object.entries(value)) {
    if (/token|authorization|api[_-]?key|secret|password/i.test(key)) continue;
    out[key] = v && typeof v === 'object' ? redactForLog(v) : v;
  }
  return out;
}
