import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MAISHAPAY_PROVIDERS, gatewayModeFor, invoiceReference, maishapayProvider, normaliseMobileMoneyPhone,
  readCheckResponse, readInitiateResponse, redactForLog, walletId,
} from '@/lib/maishapayRules';
import { callbackTokenValid, startMobileMoneyPayment } from '@/lib/payments';
import { MOBILE_MONEY_OPERATORS } from '@/lib/checkoutRules';
import { calls, enqueue, reset } from '../support/fakePool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

// Real answers from MaishaPay's sandbox, 2026-11-25 (numbers shortened).
const SANDBOX_INITIATE_SUCCESS = {
  status_code: 200, transactionStatus: 'SUCCESS', transactionId: 276816, originatingTransactionId: 'LP-2026-1-AAAA',
  order: { customerFullName: null, customerPhoneNumber: '+243990000000', customerEmailAdress: null, cost: { amount: 1, frais: 0.04, total: 1.04, currency: 'USD' } },
  paymentChannel: { channel: 'MOBILEMONEY', provider: { libelle: 'AIRTEL', picture: 'service-logos/airtelmoney.png' }, walletID: '+243990000000' },
};
const WALLET_ERROR = { status_code: 400, type: 'errors', title: 'WalletID error', errors: { message: 'Veuillez renseigner un numéro de téléphone correspondant au provider ORANGE', details: [] } };
const PROVIDER_ERROR = { status_code: 400, title: 'Provider not found', errors: { message: 'No Provider found with transmitted value', details: [] } };
const BAD_KEYS = { status_code: 400, title: 'Compte not found', errors: { message: 'Merchant account not found, Please enter the correct APIKey', details: [] } };
const CHECK_SUCCESS = {
  transaction_type: 'C2B | Collect', status_code: 200, transactionStatus: 'SUCCESS', message: 'General Payments',
  transactionId: 276815, originatingTransactionId: 'LP-2026-1-AAAA', orderNumber: null,
  order: { customerFullName: null, customerPhoneNumber: '+243990000000', customerEmailAdress: null, cost: { amount: 25, frais: 0.88, total: 25.88, currency: 'USD' } },
  paymentChannel: { channel: 'MOBILEMONEY', provider: 'AIRTEL' }, walletID: '+243990000000',
};

test('only a DRC mobile number is a mobile-money number, sent as +243…', () => {
  assert.equal(normaliseMobileMoneyPhone('0812345678'), '243812345678');
  assert.equal(normaliseMobileMoneyPhone('+243 97 123 4567'), '243971234567');
  assert.equal(normaliseMobileMoneyPhone('00243991234567'), '243991234567');
  assert.equal(normaliseMobileMoneyPhone('447932673460'), null);
  assert.equal(normaliseMobileMoneyPhone('243123'), null);
  assert.equal(walletId('0991234567'), '+243991234567');
  assert.equal(walletId('12'), null);
  assert.equal(invoiceReference(42, 2026, 'abcd99'), 'LP-2026-42-ABCD');
});

test('the checkout operators are exactly MaishaPay’s DRC provider codes', () => {
  assert.deepEqual(MOBILE_MONEY_OPERATORS.map((o) => o.id).sort(), Object.keys(MAISHAPAY_PROVIDERS).sort());
  assert.equal(maishapayProvider('airtel'), 'AIRTEL');
  assert.equal(maishapayProvider('MPESA'), 'MPESA');
  assert.equal(maishapayProvider('vodacom'), null, 'MaishaPay answers "Provider not found" to VODACOM');
  assert.equal(maishapayProvider(undefined), null);
});

test('the mode is explicit and both keys must carry its prefix', () => {
  assert.equal(gatewayModeFor('sandbox', 'MP-SBPK-a', 'MP-SBPK-b'), 0);
  assert.equal(gatewayModeFor('live', 'MP-LIVEPK-a', 'MP-LIVEPK-b'), 1);
  assert.equal(gatewayModeFor('live', 'MP-SBPK-a', 'MP-SBPK-b'), null, 'sandbox keys are never live');
  assert.equal(gatewayModeFor('sandbox', 'MP-LIVEPK-a', 'MP-LIVEPK-b'), null, 'live keys are never sandbox');
  assert.equal(gatewayModeFor('live', 'MP-LIVEPK-a', 'MP-SBPK-b'), null);
  assert.equal(gatewayModeFor(undefined, 'MP-SBPK-a', 'MP-SBPK-b'), null, 'no mode, no payments');
  assert.equal(gatewayModeFor('sandbox', '', 'MP-SBPK-b'), null);
});

test('reading the collection answer: pending, sandbox success, wrong operator, refusal', () => {
  assert.deepEqual(readInitiateResponse(202, { status_code: 202, transactionStatus: 'PENDING ', transactionId: 12345 }), { ok: true, transactionId: '12345', state: 'pending' });
  assert.deepEqual(readInitiateResponse(200, SANDBOX_INITIATE_SUCCESS), { ok: true, transactionId: '276816', state: 'paid' });
  assert.equal(readInitiateResponse(400, WALLET_ERROR).error, 'wallet');
  assert.equal(readInitiateResponse(400, PROVIDER_ERROR).error, 'provider');
  assert.equal(readInitiateResponse(404, BAD_KEYS).error, 'provider');
  assert.equal(readInitiateResponse(500, null).ok, false);
});

test('only a matching SUCCESS status check whose amount covers the invoice marks it paid', () => {
  const invoice = { amount: '25.00', currency: 'USD', reference: 'LP-2026-1-AAAA' };
  const tx = (over) => ({ ...CHECK_SUCCESS, ...over });
  assert.deepEqual(readCheckResponse(CHECK_SUCCESS, invoice), { state: 'paid', transactionId: '276815' });
  assert.equal(readCheckResponse([CHECK_SUCCESS], invoice).state, 'paid', 'an array answer is read too');
  assert.equal(readCheckResponse(tx({ transactionStatus: 'FAILED' }), invoice).state, 'failed');
  assert.equal(readCheckResponse(tx({ transactionStatus: 'PENDING' }), invoice).state, 'pending');
  assert.equal(readCheckResponse([], invoice).state, 'pending', 'MaishaPay answers [] for an unknown reference');
  assert.equal(readCheckResponse(BAD_KEYS, invoice).state, 'pending');
  assert.equal(readCheckResponse(tx({ order: { cost: { amount: 20, currency: 'USD' } } }), invoice).state, 'mismatch');
  assert.equal(readCheckResponse(tx({ order: { cost: { amount: 25, currency: 'CDF' } } }), invoice).state, 'mismatch');
  assert.equal(readCheckResponse(tx({ originatingTransactionId: 'LP-2026-2-BBBB' }), invoice).state, 'mismatch');
  assert.equal(readCheckResponse(tx({ transaction_type: 'B2C | Transfert' }), invoice).state, 'mismatch', 'a payout is never a payment');
});

test('payment logs never keep a key or token', () => {
  assert.deepEqual(
    redactForLog({ a: 1, publicApiKey: 'MP-x', secretApiKey: 'MP-y', token: 'x', nested: { Authorization: 'Bearer y', ok: true } }),
    { a: 1, nested: { ok: true } },
  );
});

test('a callback without its invoice token is rejected before any query', async () => {
  reset();
  assert.equal(await callbackTokenValid(5, ''), false);
  assert.equal(await callbackTokenValid(Number.NaN, 'a'.repeat(48)), false);
  assert.equal(calls.length, 0);
});

async function withMaishapay(fn, { mode = 'sandbox', answer = SANDBOX_INITIATE_SUCCESS, httpStatus = 200 } = {}) {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const sent = [];
  process.env.MAISHAPAY_MODE = mode;
  process.env.MAISHAPAY_PUBLIC_KEY = mode === 'live' ? 'MP-LIVEPK-pub' : 'MP-SBPK-pub';
  process.env.MAISHAPAY_SECRET_KEY = mode === 'live' ? 'MP-LIVEPK-sec' : 'MP-SBPK-sec';
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(answer), { status: httpStatus, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await fn(sent);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test('nothing is called while MaishaPay is not configured', async () => {
  reset();
  delete process.env.MAISHAPAY_MODE;
  assert.deepEqual(await startMobileMoneyPayment({ agentId: 1, packageId: 3, phone: '0991234567', operator: 'airtel' }), { ok: false, error: 'not_configured' });
  assert.equal(calls.length, 0);
});

test('the phone and operator are checked before any query', async () => {
  await withMaishapay(async (sent) => {
    reset();
    assert.equal((await startMobileMoneyPayment({ agentId: 1, packageId: 3, phone: '12', operator: 'airtel' })).error, 'phone');
    assert.equal((await startMobileMoneyPayment({ agentId: 1, packageId: 3, phone: '0991234567', operator: 'vodacom' })).error, 'operator');
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
  });
});

test('a collection request carries the keys in the body, the operator, +243 and a tokenised callback', async () => {
  await withMaishapay(async (sent) => {
    reset();
    enqueue([{ id: 7, vendor_id: 70 }]); // agent
    enqueue([{ id: 3, price: '25.00', title: 'Gold' }]); // package
    enqueue([{ id: '41' }]); // nextval
    enqueue([]); // INSERT invoice
    enqueue([]); // log initiate
    enqueue([]); // UPDATE order_number
    enqueue([{ id: 41, reference: 'LP-2026-41-AAAA', amount: '25.00', currency: 'USD', status: 'pending', provider: 'maishapay' }]); // settle: invoice
    // the status check then gets the same canned answer (a collection SUCCESS
    // whose reference is not this invoice's) → mismatch, never paid.
    const result = await startMobileMoneyPayment({ agentId: 7, packageId: 3, phone: '099 123 4567', operator: 'airtel' });
    assert.equal(result.ok, true);
    assert.match(result.reference, /^LP-\d{4}-41-[0-9A-F]{4}$/);

    const [collect, check] = sent;
    assert.equal(collect.url, 'https://marchand.maishapay.online/api/collect/v2/store/mobileMoney');
    assert.equal(collect.body.gatewayMode, 0);
    assert.equal(collect.body.publicApiKey, 'MP-SBPK-pub');
    assert.equal(collect.body.secretApiKey, 'MP-SBPK-sec');
    assert.equal(collect.body.transactionReference, result.reference);
    assert.deepEqual(collect.body.order, { amount: 25, currency: 'USD' });
    assert.equal(collect.body.paymentChannel.channel, 'MOBILEMONEY');
    assert.equal(collect.body.paymentChannel.provider, 'AIRTEL');
    assert.equal(collect.body.paymentChannel.walletID, '+243991234567');
    assert.match(collect.body.paymentChannel.callbackUrl, /\/api\/payments\/maishapay\/callback\?invoice=41&token=[0-9a-f]{48}$/);
    assert.equal(check.url, 'https://marchand.maishapay.online/api/transaction/rest/v2/check?useRef=1');
    assert.equal(check.body.transactionId, 'LP-2026-41-AAAA', 'looked up by OUR reference');

    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO invoices'));
    assert.deepEqual(insert.values.slice(9), ['maishapay', 'AIRTEL', true], 'provider, operator, sandbox flag');
    const logged = calls.filter((c) => c.sql.startsWith('INSERT INTO payment_logs')).map((c) => c.values[4]).join(' ');
    assert.doesNotMatch(logged, /MP-SBPK|token=[0-9a-f]/, 'no key or callback token in payment_logs');
    assert.ok(!calls.some((c) => /memberships/.test(c.sql)), 'a mismatching check never writes a membership');
  });
});

test('a number on another operator is refused with operator_phone and the invoice fails', async () => {
  await withMaishapay(async () => {
    reset();
    enqueue([{ id: 7, vendor_id: 70 }]);
    enqueue([{ id: 3, price: '25.00', title: 'Gold' }]);
    enqueue([{ id: '42' }]);
    const result = await startMobileMoneyPayment({ agentId: 7, packageId: 3, phone: '0991234567', operator: 'orange' });
    assert.deepEqual(result, { ok: false, error: 'operator_phone' });
    assert.ok(calls.some((c) => c.sql.startsWith("UPDATE invoices SET status = 'failed'")));
  }, { answer: WALLET_ERROR, httpStatus: 400 });
});

test('MaishaPay credentials are server-only and FlexPaie is gone', () => {
  const src = read('lib/maishapay.js');
  assert.match(src, /^import 'server-only';/);
  assert.doesNotMatch(src, /NEXT_PUBLIC_MAISHAPAY/);
  assert.doesNotMatch(read('components/AgentCheckout.js'), /MAISHAPAY_|maishapay'/, 'the client imports only the pure rules');
  for (const gone of ['lib/flexpaie.js', 'lib/flexpaieRules.js', 'app/api/payments/flexpaie']) {
    assert.equal(existsSync(path.join(here, '..', '..', gone)), false, gone);
  }
});
