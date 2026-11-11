/**
 * MaishaPay — the pure half: operators, phone format, request bodies, and how
 * a MaishaPay answer is read. lib/maishapay.js does the HTTP,
 * lib/maishapayPayments.js the database. tests/unit/maishapay.test.js pins
 * every rule here.
 *
 * SOURCE OF THE API SHAPE — read before going live (2026-11-12).
 *   - MaishaPay's own REST page (maishapay.net/api_docs/ApiRest.html): keys in
 *     the body (`gatewayMode` 0 sandbox / 1 live, `publicApiKey`,
 *     `secretApiKey`), mobile money is a server-to-server request after which
 *     the operator pushes a USSD prompt to the payer; first answer
 *     {original: {status: 200, data: {originatingTransactionId, statusCode:
 *     "202", statusDescription: "Accepted", transactionId}}}.
 *   - The v2 paths, the nested `order` / `paymentChannel` body, card payments
 *     returning a `paymentPage` URL, and the status check
 *     (POST {transaction}/rest/v2/check?useRef=1 → `transactionStatus`)
 *     come from the MIT Laravel package uzhlaravel/maishapay
 *     (github.com/Uzziahlukeka/maisha-pay), not from MaishaPay's own page,
 *     which documents no status check and no callback body.
 * Every field name below must be confirmed with a sandbox payment (MaishaPay
 * requires one before it activates live keys) before MAISHAPAY_GATEWAY_MODE=1.
 * Anything this file does not recognise is read as "still pending", never
 * as paid.
 */

/** Mobile-money operators MaishaPay names for the DRC, as its `provider` codes. */
export const MAISHAPAY_MOBILE_PROVIDERS = ['MPESA', 'ORANGE', 'AIRTEL', 'AFRICELL'];
/** Card networks, as the `provider` of a CARD channel. */
export const MAISHAPAY_CARD_PROVIDERS = ['VISA', 'MASTERCARD'];
export const MAISHAPAY_CHANNELS = ['mobile_money', 'card'];
export const MAISHAPAY_CURRENCIES = ['USD', 'CDF'];

/** What an agent sees for each code. */
export const MAISHAPAY_PROVIDER_LABELS = {
  MPESA: 'M-Pesa',
  ORANGE: 'Orange Money',
  AIRTEL: 'Airtel Money',
  AFRICELL: 'Afrimoney',
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
};

export function isValidProvider(channel, provider) {
  if (channel === 'mobile_money') return MAISHAPAY_MOBILE_PROVIDERS.includes(provider);
  if (channel === 'card') return MAISHAPAY_CARD_PROVIDERS.includes(provider);
  return false;
}

/**
 * A Congolese mobile-money number: 243 + 9 digits, mobile ranges only
 * (8x / 9x). Accepts "0812345678", "812345678", "+243 81 234 5678", "00243…".
 * Anything else is null — mobile money only exists on a DRC number.
 */
export function normaliseDrcMobile(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `243${digits.slice(1)}`;
  if (digits.length === 9) digits = `243${digits}`;
  return /^243[89]\d{8}$/.test(digits) ? digits : null;
}

/** MaishaPay writes wallet numbers with the plus: "+24381xxxxxxx". */
export function walletId(digits) {
  return `+${digits}`;
}

/** Our invoice reference, echoed by MaishaPay as originatingTransactionId. */
export function maishapayReference(invoiceId, year, randomHex) {
  return `LPM-${year}-${invoiceId}-${String(randomHex).slice(0, 4).toUpperCase()}`;
}

/**
 * Sandbox keys start MP-SB…, live keys MP-LIVE…. A key that does not match the
 * gateway mode is a configuration error, refused before any money moves.
 */
export function keysMatchMode(publicKey, secretKey, gatewayMode) {
  const pub = String(publicKey || '');
  const sec = String(secretKey || '');
  if (gatewayMode === 1) return pub.startsWith('MP-LIVEPK-') && sec.startsWith('MP-LIVESK-');
  return pub.startsWith('MP-SBPK-') && sec.startsWith('MP-SBSK-');
}

/** The body of a collection request. Keys are added by lib/maishapay.js. */
export function buildCollectBody({ reference, amount, currency, channel, provider, phone, customerName, callbackUrl }) {
  const order = {
    amount: Number(amount),
    currency,
    customerFullName: customerName || null,
    customerEmailAdress: null, // sic: the field is spelled this way
  };
  const paymentChannel = { provider, callbackUrl };
  if (channel === 'mobile_money') {
    paymentChannel.channel = 'MOBILEMONEY';
    paymentChannel.walletID = walletId(phone);
  } else {
    paymentChannel.channel = 'CARD';
    if (phone) order.customerPhoneNumber = walletId(phone);
  }
  return { transactionReference: reference, order, paymentChannel };
}

/** MaishaPay sometimes wraps its answer in {original: {data}}, sometimes not. */
function unwrap(body) {
  if (!body || typeof body !== 'object') return {};
  return body.original?.data ?? body.data ?? body.original ?? body;
}

function findPaymentPage(body) {
  const candidates = [body, body?.data, body?.original, body?.original?.data];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const url = c.paymentPage ?? c.payment_page ?? c.paymentUrl ?? c.redirectUrl ?? c.url;
    if (typeof url === 'string' && /^https:\/\//.test(url)) return url;
  }
  return null;
}

/**
 * The first answer to a collection request.
 * @returns {{ok: true, transactionId: string|null, paymentPage: string|null} | {ok: false, message: string}}
 */
export function readCollectResponse(body, channel) {
  const data = unwrap(body);
  const statusCode = String(data.statusCode ?? data.status ?? body?.original?.status ?? '');
  const transactionId = data.transactionId ?? data.transactionID ?? null;
  const message = String(data.statusDescription ?? data.message ?? body?.message ?? 'MaishaPay a refusé la demande').slice(0, 300);
  if (channel === 'card') {
    const page = findPaymentPage(body);
    if (page) return { ok: true, transactionId: transactionId == null ? null : String(transactionId), paymentPage: page };
    return { ok: false, message };
  }
  if (['200', '201', '202'].includes(statusCode) && transactionId != null) {
    return { ok: true, transactionId: String(transactionId), paymentPage: null };
  }
  return { ok: false, message };
}

/** SUCCESS / FAILED / CANCELLED / PENDING, the same words the Laravel package uses. */
export function normaliseStatus(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'APPROVED'].includes(s)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'ERROR', 'DECLINED', 'REJECTED'].includes(s)) return 'FAILED';
  if (['CANCELLED', 'CANCELED'].includes(s)) return 'CANCELLED';
  return 'PENDING';
}

function pickTransaction(body) {
  const candidates = [body, body?.data, body?.transaction, body?.original?.data, body?.data?.transaction];
  return candidates.find((c) => c && typeof c === 'object' && (c.transactionStatus != null || c.status != null)) || null;
}

/**
 * The verdict on one invoice from a status check. Only a check — never a
 * callback body or a return URL, which anyone can forge — can mark an invoice
 * paid, and only when what MaishaPay reports covers what was invoiced.
 * @param {object} body the check answer
 * @param {{amount: number|string, currency: string, reference: string}} invoice
 * @returns {{state: 'paid'|'failed'|'pending'|'mismatch', reason?: string}}
 */
export function readCheckResponse(body, invoice) {
  const tx = pickTransaction(body);
  if (!tx) return { state: 'pending', reason: 'no transaction' };
  const ref = tx.originatingTransactionId ?? tx.transactionReference ?? tx.reference ?? null;
  if (ref != null && String(ref) !== String(invoice.reference)) return { state: 'mismatch', reason: 'reference differs' };
  const status = normaliseStatus(tx.transactionStatus ?? tx.status);
  if (status === 'FAILED' || status === 'CANCELLED') {
    return { state: 'failed', reason: String(tx.statusDescription ?? tx.description ?? status.toLowerCase()).slice(0, 300) };
  }
  if (status !== 'SUCCESS') return { state: 'pending', reason: `status ${tx.transactionStatus ?? tx.status ?? 'absent'}` };
  const amount = tx.amount ?? tx.montant;
  if (amount != null) {
    const paid = Number(amount);
    if (!Number.isFinite(paid) || paid + 0.005 < Number(invoice.amount)) return { state: 'mismatch', reason: 'amount below invoice' };
  }
  const currency = tx.currency ?? tx.devise;
  if (currency && String(currency).toUpperCase() !== String(invoice.currency).toUpperCase()) {
    return { state: 'mismatch', reason: 'currency differs' };
  }
  return { state: 'paid' };
}

/** What goes into payment_logs: never a key, token or secret. */
export function redactForLog(value) {
  if (value == null || typeof value !== 'object') return value ?? null;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, v] of Object.entries(value)) {
    if (/token|authorization|api[_-]?key|secret|password|publicapikey/i.test(key)) continue;
    out[key] = v && typeof v === 'object' ? redactForLog(v) : v;
  }
  return out;
}

/**
 * When the renewal sweep should act on a subscription: auto-renewing, active,
 * ending within `leadDays`, not prompted in the last 20 hours, fewer than
 * three prompts this period.
 */
export function renewalDue(sub, now = new Date(), { leadDays = 1, maxAttempts = 3 } = {}) {
  if (!sub?.auto_renew || sub.status !== 'active' || !sub.current_period_end) return false;
  const end = new Date(sub.current_period_end).getTime();
  if (!Number.isFinite(end) || end - now.getTime() > leadDays * 86_400_000) return false;
  if ((Number(sub.renewal_attempts) || 0) >= maxAttempts) return false;
  if (sub.renewal_notified_at && now.getTime() - new Date(sub.renewal_notified_at).getTime() < 20 * 3_600_000) return false;
  return true;
}

/** A renewed period starts where the paid one ends, never in the past. */
export function renewalStart(currentPeriodEnd, now = new Date()) {
  const end = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  return end && end.getTime() > now.getTime() ? end : now;
}
