#!/usr/bin/env node
/**
 * MaishaPay SANDBOX payment test — one mobile-money collection, then its
 * status. Touches no database and no listing; it only talks to MaishaPay.
 *
 *   MAISHAPAY_PUBLIC_KEY=… MAISHAPAY_SECRET_KEY=… \
 *     node scripts/maishapay-sandbox-test.js --phone +243XXXXXXXXX --provider AIRTEL [--amount 1000 --currency CDF]
 *
 *   --provider   MPESA | ORANGE | AIRTEL (required — never guessed from the number)
 *   --amount     default 1000 (minimum 100 in CDF, 0.5 in USD)
 *   --currency   CDF (default) | USD
 *   --callback   URL MaishaPay POSTs the final status to (v2 only). Defaults
 *                to MAISHAPAY_CALLBACK_URL, else a Lukka Place URL nothing
 *                listens on yet: the script reads the result with the
 *                status check instead.
 *   --check <id> only look up an earlier transaction (merchant reference)
 *
 * The keys are read from the environment only, never from the command line
 * (shell history) and never printed. gatewayMode is always 0 (sandbox).
 *
 * API shape (MaishaPay REST API doc, Postman 2sAYQXnCU4, read 2026-11-25):
 *   base https://marchand.maishapay.online/api
 *   M-Pesa         POST /payment/rest/vers1.0/merchant   (v1, flat body, the
 *                  connection stays open until the final status, no callback)
 *   Orange/Airtel  POST /collect/v2/store/mobileMoney    (v2, answers 202
 *                  PENDING, final status POSTed to callbackUrl)
 *   status         POST /transaction/rest/v2/check?useRef=1 {transactionId: <our reference>}
 * The keys travel in the JSON body (publicApiKey / secretApiKey), not a header.
 */

const BASE_URL = 'https://marchand.maishapay.online/api';
const SANDBOX = 0;
const PROVIDERS = new Set(['MPESA', 'ORANGE', 'AIRTEL']);
const POLL_EVERY_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function keys() {
  const publicApiKey = String(process.env.MAISHAPAY_PUBLIC_KEY || '').trim();
  const secretApiKey = String(process.env.MAISHAPAY_SECRET_KEY || '').trim();
  if (!publicApiKey || !secretApiKey) fail('Set MAISHAPAY_PUBLIC_KEY and MAISHAPAY_SECRET_KEY in the environment (sandbox keys).');
  return { publicApiKey, secretApiKey };
}

/** The request as printed: keys replaced, so the output can be shared. */
function redact(body) {
  return JSON.stringify({ ...body, publicApiKey: '…', secretApiKey: '…' }, null, 2);
}

async function post(path, body, timeoutMs) {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { httpStatus: response.status, json, text, ms: Date.now() - started };
}

function show(label, result) {
  console.log(`\n— ${label}: HTTP ${result.httpStatus} in ${(result.ms / 1000).toFixed(1)} s`);
  console.log(result.json ? JSON.stringify(result.json, null, 2) : result.text.slice(0, 2000));
}

/** SUCCESS / FAILED / PENDING (or null) from a check, a v2 or a v1 answer. */
function statusOf(json) {
  const raw = json?.transactionStatus ?? json?.data?.status ?? null;
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (s === 'SUCCESS' || s === 'APPROVED') return 'SUCCESS';
  if (s === 'FAILED' || s === 'DECLINED') return 'FAILED';
  if (s === 'PENDING') return 'PENDING';
  return s;
}

async function check(reference) {
  return post('/transaction/rest/v2/check?useRef=1', { gatewayMode: SANDBOX, ...keys(), transactionId: reference }, 30_000);
}

async function pollUntilFinal(reference) {
  const deadline = Date.now() + POLL_FOR_MS;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    const result = await check(reference);
    const status = statusOf(result.json);
    if (status !== last) {
      show(`Status check (${reference})`, result);
      last = status;
    } else process.stdout.write('.');
    if (status === 'SUCCESS' || status === 'FAILED') return status;
  }
  return last || 'UNKNOWN';
}

async function main() {
  const opts = args(process.argv.slice(2));

  if (opts.check) {
    const result = await check(String(opts.check));
    show(`Status check (${opts.check})`, result);
    console.log(`\nStatus: ${statusOf(result.json) || 'not stated'}`);
    return;
  }

  const provider = String(opts.provider || '').trim().toUpperCase();
  if (!PROVIDERS.has(provider)) fail('--provider must be MPESA, ORANGE or AIRTEL (it is not guessed from the number).');
  const walletID = String(opts.phone || '').replace(/[\s.-]/g, '');
  if (!/^\+243\d{9}$/.test(walletID)) fail('--phone must be a DRC number in international format: +243 followed by 9 digits.');
  const currency = String(opts.currency || 'CDF').trim().toUpperCase();
  if (currency !== 'CDF' && currency !== 'USD') fail('--currency must be CDF or USD.');
  const amount = Number(opts.amount ?? 1000);
  const minimum = currency === 'USD' ? 0.5 : 100;
  if (!Number.isFinite(amount) || amount < minimum) fail(`--amount must be at least ${minimum} ${currency}.`);

  const reference = `LP-TEST-${Date.now().toString(36).toUpperCase()}`;
  const callbackUrl = String(opts.callback || process.env.MAISHAPAY_CALLBACK_URL || 'https://lukkaplace.com/api/payments/maishapay/callback');

  console.log(`MaishaPay SANDBOX test (gatewayMode ${SANDBOX})`);
  console.log(`Reference ${reference} · ${amount} ${currency} · ${provider} · ${walletID}`);

  let body;
  let path;
  if (provider === 'MPESA') {
    // v1: M-Pesa only, flat body, the answer is the final status.
    path = '/payment/rest/vers1.0/merchant';
    body = { transactionReference: reference, gatewayMode: SANDBOX, ...keys(), amount, currency, channel: 'MOBILEMONEY', provider, walletID };
  } else {
    path = '/collect/v2/store/mobileMoney';
    body = {
      transactionReference: reference,
      gatewayMode: SANDBOX,
      ...keys(),
      order: { amount, currency, customerFullName: 'Test Lukka Place' },
      paymentChannel: { channel: 'MOBILEMONEY', provider, walletID, callbackUrl },
    };
  }
  console.log(`\nPOST ${BASE_URL}${path}\n${redact(body)}`);

  let result;
  try {
    result = await post(path, body, provider === 'MPESA' ? POLL_FOR_MS : 60_000);
  } catch (err) {
    fail(`request failed before any answer: ${err.cause?.code || err.name}: ${err.message}`);
  }
  show('Initiation', result);

  let status = statusOf(result.json);
  if (status !== 'SUCCESS' && status !== 'FAILED' && result.httpStatus < 400) {
    console.log(`\nWaiting for the final status (every ${POLL_EVERY_MS / 1000} s, up to ${POLL_FOR_MS / 60_000} min)…`);
    status = await pollUntilFinal(reference);
  }
  console.log(`\n\nResult: ${status || 'not stated'} — reference ${reference}`);
  console.log(`Look it up again later: node scripts/maishapay-sandbox-test.js --check ${reference}`);
}

main().catch((err) => fail(err.stack || err.message));
