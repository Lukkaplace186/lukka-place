import 'server-only';
import { buildCollectBody, keysMatchMode, readCollectResponse } from './maishapayRules';

/**
 * MaishaPay HTTP client. Credentials are server-only env vars — never
 * NEXT_PUBLIC_*, never returned to a browser, never written to payment_logs:
 *   MAISHAPAY_PUBLIC_KEY     MP-SBPK-… (sandbox) or MP-LIVEPK-… (live)
 *   MAISHAPAY_SECRET_KEY     MP-SBSK-… or MP-LIVESK-…
 *   MAISHAPAY_GATEWAY_MODE   0 sandbox (default), 1 live
 *   MAISHAPAY_COLLECT_URL    default https://marchand.maishapay.online/api/collect
 *   MAISHAPAY_CHECK_URL      default https://marchand.maishapay.online/api/transaction/rest/v2/check
 * Keys unset, or keys that do not match the mode → isMaishapayConfigured() is
 * false and nothing is called. lib/maishapayRules.js says where the request
 * and response shapes come from and what to confirm before going live.
 */

const TIMEOUT_MS = 30_000;
const DEFAULT_COLLECT_URL = 'https://marchand.maishapay.online/api/collect';
const DEFAULT_CHECK_URL = 'https://marchand.maishapay.online/api/transaction/rest/v2/check';

function config() {
  const mode = String(process.env.MAISHAPAY_GATEWAY_MODE || '0').trim() === '1' ? 1 : 0;
  return {
    publicKey: String(process.env.MAISHAPAY_PUBLIC_KEY || '').trim(),
    secretKey: String(process.env.MAISHAPAY_SECRET_KEY || '').trim(),
    gatewayMode: mode,
    collectUrl: String(process.env.MAISHAPAY_COLLECT_URL || DEFAULT_COLLECT_URL).trim().replace(/\/+$/, ''),
    checkUrl: String(process.env.MAISHAPAY_CHECK_URL || DEFAULT_CHECK_URL).trim(),
  };
}

export function isMaishapayConfigured() {
  const c = config();
  return /^https:\/\//.test(c.collectUrl) && /^https:\/\//.test(c.checkUrl) && keysMatchMode(c.publicKey, c.secretKey, c.gatewayMode);
}

/** 'sandbox' | 'live' — shown to the team, never to agents. */
export function maishapayMode() {
  return config().gatewayMode === 1 ? 'live' : 'sandbox';
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

function withKeys(body) {
  const c = config();
  return { ...body, gatewayMode: c.gatewayMode, publicApiKey: c.publicKey, secretApiKey: c.secretKey };
}

/**
 * Start a collection: mobile money (the operator pushes a PIN prompt to the
 * payer's phone) or card (MaishaPay answers with its card page to open).
 * @returns {Promise<{httpStatus: number, body: object|null, request: object, result: ReturnType<typeof readCollectResponse>}>}
 */
export async function startMaishapayCollection(params) {
  if (!isMaishapayConfigured()) throw new Error('MaishaPay is not configured');
  const request = buildCollectBody(params);
  const path = params.channel === 'card' ? '/v2/store/card' : '/v2/store/mobileMoney';
  const { status, body } = await post(`${config().collectUrl}${path}`, withKeys(request));
  // Logged without the keys, and without the callback token.
  const loggedRequest = {
    ...request,
    paymentChannel: { ...request.paymentChannel, callbackUrl: String(request.paymentChannel.callbackUrl).replace(/token=[^&]+/, 'token=…') },
  };
  const result = status >= 200 && status < 300 ? readCollectResponse(body, params.channel) : { ok: false, message: `HTTP ${status}` };
  return { httpStatus: status, body, request: loggedRequest, result };
}

/**
 * Where a transaction stands, looked up by OUR reference (?useRef=1).
 * @returns {Promise<{httpStatus: number, body: object|null}>}
 */
export async function checkMaishapayTransaction(reference) {
  if (!isMaishapayConfigured()) throw new Error('MaishaPay is not configured');
  const url = `${config().checkUrl}${config().checkUrl.includes('?') ? '&' : '?'}useRef=1`;
  const { status, body } = await post(url, withKeys({ transactionId: reference }));
  return { httpStatus: status, body };
}
