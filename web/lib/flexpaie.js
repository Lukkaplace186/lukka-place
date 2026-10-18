import 'server-only';
import { FLEXPAIE_TYPE_MOBILE_MONEY, readInitiateResponse } from './flexpaieRules';

/**
 * FlexPaie HTTP client. Credentials are server-only env vars — never
 * NEXT_PUBLIC_*, never returned to a browser:
 *   FLEXPAIE_BASE_URL     the API root FlexPaie gives the merchant, up to and
 *                         including /api/rest/v1 (e.g. https://…/api/rest/v1)
 *   FLEXPAIE_MERCHANT_ID  the merchant code
 *   FLEXPAIE_API_KEY      the Bearer token
 * All three unset → isFlexpaieConfigured() is false and nothing is called.
 * See lib/flexpaieRules.js for where the request/response shape comes from
 * and what must be confirmed before production.
 */

const TIMEOUT_MS = 20_000;

function config() {
  const baseUrl = String(process.env.FLEXPAIE_BASE_URL || '').trim().replace(/\/+$/, '');
  const merchant = String(process.env.FLEXPAIE_MERCHANT_ID || '').trim();
  const apiKey = String(process.env.FLEXPAIE_API_KEY || '').trim();
  return { baseUrl, merchant, apiKey };
}

export function isFlexpaieConfigured() {
  const { baseUrl, merchant, apiKey } = config();
  // https only: the token travels in a header (the community SDK's plain-http
  // base URL and disabled certificate check are not copied).
  return /^https:\/\//.test(baseUrl) && Boolean(merchant) && Boolean(apiKey);
}

async function call(path, init) {
  const { baseUrl, apiKey } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/**
 * Ask FlexPaie to push a mobile-money payment prompt to `phone`.
 * @returns {Promise<{httpStatus: number, body: object|null, request: object, result: ReturnType<typeof readInitiateResponse>}>}
 */
export async function initiateFlexpaiePayment({ reference, phone, amount, currency, callbackUrl }) {
  if (!isFlexpaieConfigured()) throw new Error('FlexPaie is not configured');
  const request = {
    merchant: config().merchant,
    type: FLEXPAIE_TYPE_MOBILE_MONEY,
    reference,
    phone,
    amount: Number(amount),
    currency,
    callbackUrl,
  };
  const { status, body } = await call('/paymentService', { method: 'POST', body: JSON.stringify(request) });
  // The callback URL carries a secret token: logged without it.
  const loggedRequest = { ...request, callbackUrl: callbackUrl.replace(/token=[^&]+/, 'token=…') };
  return { httpStatus: status, body, request: loggedRequest, result: status >= 200 && status < 300 ? readInitiateResponse(body) : { ok: false, message: `HTTP ${status}` } };
}

/** @returns {Promise<{httpStatus: number, body: object|null}>} */
export async function checkFlexpaieTransaction(orderNumber) {
  if (!isFlexpaieConfigured()) throw new Error('FlexPaie is not configured');
  const { status, body } = await call(`/check/${encodeURIComponent(orderNumber)}`, { method: 'GET' });
  return { httpStatus: status, body };
}
