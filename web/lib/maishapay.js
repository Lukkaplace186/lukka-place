import 'server-only';
import { gatewayModeFor, readInitiateResponse } from './maishapayRules';

/**
 * MaishaPay HTTP client. Credentials are server-only env vars — never
 * NEXT_PUBLIC_*, never returned to a browser, never logged:
 *   MAISHAPAY_PUBLIC_KEY   MP-LIVEPK-… (live) or MP-SBPK-… (sandbox)
 *   MAISHAPAY_SECRET_KEY   same prefix as the public key
 *   MAISHAPAY_MODE         'live' or 'sandbox' — must match the keys' prefix
 * Anything missing or disagreeing → isMaishapayConfigured() is false and
 * nothing is called. MaishaPay takes the keys in the JSON body, not a header.
 * lib/maishapayRules.js says where the request/response shape comes from.
 */

const BASE_URL = 'https://marchand.maishapay.online/api';
const TIMEOUT_MS = 30_000;

function config() {
  const publicApiKey = String(process.env.MAISHAPAY_PUBLIC_KEY || '').trim();
  const secretApiKey = String(process.env.MAISHAPAY_SECRET_KEY || '').trim();
  const gatewayMode = gatewayModeFor(process.env.MAISHAPAY_MODE, publicApiKey, secretApiKey);
  return { publicApiKey, secretApiKey, gatewayMode };
}

export function isMaishapayConfigured() {
  return config().gatewayMode !== null;
}

/** True when payments go to MaishaPay's sandbox: no money moves. */
export function isMaishapaySandbox() {
  return config().gatewayMode === 0;
}

async function call(path, payload) {
  const { publicApiKey, secretApiKey, gatewayMode } = config();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ gatewayMode, publicApiKey, secretApiKey, ...payload }),
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
 * Ask MaishaPay to push a mobile-money payment prompt to `walletID`.
 * @returns {Promise<{httpStatus: number, body: object|null, request: object, result: ReturnType<typeof readInitiateResponse>}>}
 */
export async function initiateMaishapayPayment({ reference, walletID, provider, amount, currency, callbackUrl }) {
  if (!isMaishapayConfigured()) throw new Error('MaishaPay is not configured');
  const request = {
    transactionReference: reference,
    order: { amount: Number(amount), currency },
    paymentChannel: { channel: 'MOBILEMONEY', provider, walletID, callbackUrl },
  };
  const { status, body } = await call('/collect/v2/store/mobileMoney', request);
  // The callback URL carries a secret token: logged without it. The keys are
  // added inside call() and never reach this copy.
  const loggedRequest = { ...request, paymentChannel: { ...request.paymentChannel, callbackUrl: callbackUrl.replace(/token=[^&]+/, 'token=…') } };
  return { httpStatus: status, body, request: loggedRequest, result: readInitiateResponse(status, body) };
}

/** Look a collection up by OUR reference — works even if the initiate answer was lost. */
export async function checkMaishapayTransaction(reference) {
  if (!isMaishapayConfigured()) throw new Error('MaishaPay is not configured');
  const { status, body } = await call('/transaction/rest/v2/check?useRef=1', { transactionId: reference });
  return { httpStatus: status, body };
}
