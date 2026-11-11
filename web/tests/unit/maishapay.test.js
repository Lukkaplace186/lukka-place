import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildCollectBody,
  isValidProvider,
  keysMatchMode,
  maishapayReference,
  normaliseDrcMobile,
  normaliseStatus,
  readCheckResponse,
  readCollectResponse,
  redactForLog,
  renewalDue,
  renewalStart,
} from '@/lib/maishapayRules';
import { renewalMessage } from '@/lib/subscriptionRenewals';
import { startMaishapayPayment, stopAutoRenew } from '@/lib/maishapayPayments';
import { calls, reset } from '../support/fakePool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

// ---------------------------------------------------------------------------
// Rules (lib/maishapayRules.js)
// ---------------------------------------------------------------------------

test('a DRC mobile-money number is normalised to 243 + 9 digits, anything else refused', () => {
  for (const raw of ['0812345678', '812345678', '+243 81 234 5678', '00243812345678', '243 97 123 4567']) {
    assert.match(normaliseDrcMobile(raw), /^243[89]\d{8}$/, raw);
  }
  assert.equal(normaliseDrcMobile('0812345678'), '243812345678');
  for (const raw of ['', '12345', '+44 7932 673460', '0212345678', '24381234567', null]) {
    assert.equal(normaliseDrcMobile(raw), null, String(raw));
  }
});

test('operators and card networks are checked against their channel', () => {
  for (const p of ['MPESA', 'ORANGE', 'AIRTEL', 'AFRICELL']) assert.ok(isValidProvider('mobile_money', p), p);
  for (const p of ['VISA', 'MASTERCARD']) assert.ok(isValidProvider('card', p), p);
  assert.equal(isValidProvider('mobile_money', 'VISA'), false);
  assert.equal(isValidProvider('card', 'MPESA'), false);
  assert.equal(isValidProvider('cash', 'MPESA'), false);
});

test('keys must match the gateway mode: sandbox keys never run live, and the reverse', () => {
  assert.ok(keysMatchMode('MP-SBPK-a', 'MP-SBSK-b', 0));
  assert.ok(keysMatchMode('MP-LIVEPK-a', 'MP-LIVESK-b', 1));
  assert.equal(keysMatchMode('MP-SBPK-a', 'MP-SBSK-b', 1), false);
  assert.equal(keysMatchMode('MP-LIVEPK-a', 'MP-LIVESK-b', 0), false);
  assert.equal(keysMatchMode('', '', 0), false);
});

test('the collection body: mobile money carries the wallet with a plus, card does not need one', () => {
  const mm = buildCollectBody({ reference: 'LPM-2026-1-AB12', amount: '25', currency: 'USD', channel: 'mobile_money', provider: 'MPESA', phone: '243812345678', customerName: 'Jean', callbackUrl: 'https://x/cb' });
  assert.equal(mm.transactionReference, 'LPM-2026-1-AB12');
  assert.deepEqual(mm.paymentChannel, { provider: 'MPESA', callbackUrl: 'https://x/cb', channel: 'MOBILEMONEY', walletID: '+243812345678' });
  assert.equal(mm.order.amount, 25);
  const card = buildCollectBody({ reference: 'R', amount: 25, currency: 'USD', channel: 'card', provider: 'VISA', phone: null, callbackUrl: 'https://x/cb' });
  assert.equal(card.paymentChannel.channel, 'CARD');
  assert.equal(card.paymentChannel.walletID, undefined);
  for (const body of [mm, card]) assert.ok(!('secretApiKey' in body) && !('publicApiKey' in body), 'keys are added by the HTTP client only');
});

test('the first answer: 202 Accepted with a transaction id starts mobile money; a card needs an https page', () => {
  const wrapped = { original: { status: 200, data: { originatingTransactionId: 'R', statusCode: '202', statusDescription: 'Accepted', transactionId: '108475' } } };
  assert.deepEqual(readCollectResponse(wrapped, 'mobile_money'), { ok: true, transactionId: '108475', paymentPage: null });
  assert.equal(readCollectResponse({ data: { statusCode: '400', statusDescription: 'Bad wallet' } }, 'mobile_money').ok, false);
  assert.equal(readCollectResponse(null, 'mobile_money').ok, false);
  assert.deepEqual(readCollectResponse({ paymentPage: 'https://pay.example/abc' }, 'card'), { ok: true, transactionId: null, paymentPage: 'https://pay.example/abc' });
  assert.equal(readCollectResponse({ paymentPage: 'http://pay.example/abc' }, 'card').ok, false, 'never send an agent to a plain-http card page');
  assert.equal(readCollectResponse({ data: {} }, 'card').ok, false);
});

test('only a SUCCESS that covers the invoice is paid; unknown words stay pending', () => {
  const invoice = { amount: '25.00', currency: 'USD', reference: 'LPM-2026-9-ABCD' };
  assert.deepEqual(readCheckResponse({ transactionStatus: 'SUCCESS', originatingTransactionId: invoice.reference, amount: 25, currency: 'USD' }, invoice), { state: 'paid' });
  assert.deepEqual(readCheckResponse({ data: { transactionStatus: 'COMPLETED' } }, invoice), { state: 'paid' });
  assert.equal(readCheckResponse({ transactionStatus: 'FAILED' }, invoice).state, 'failed');
  assert.equal(readCheckResponse({ transactionStatus: 'CANCELLED' }, invoice).state, 'failed');
  assert.equal(readCheckResponse({ transactionStatus: 'PROCESSING' }, invoice).state, 'pending');
  assert.equal(readCheckResponse({}, invoice).state, 'pending');
  assert.equal(readCheckResponse(null, invoice).state, 'pending');
  assert.equal(readCheckResponse({ transactionStatus: 'SUCCESS', amount: 20 }, invoice).state, 'mismatch');
  assert.equal(readCheckResponse({ transactionStatus: 'SUCCESS', currency: 'CDF' }, invoice).state, 'mismatch');
  assert.equal(readCheckResponse({ transactionStatus: 'SUCCESS', originatingTransactionId: 'OTHER' }, invoice).state, 'mismatch');
  assert.equal(normaliseStatus('approved'), 'SUCCESS');
  assert.equal(normaliseStatus(undefined), 'PENDING');
});

test('references are ours, and logs never carry keys or tokens', () => {
  assert.equal(maishapayReference(42, 2026, 'ab12ff'), 'LPM-2026-42-AB12');
  const logged = redactForLog({ publicApiKey: 'MP-SBPK-x', secretApiKey: 'MP-SBSK-y', token: 't', order: { amount: 1, apiKey: 'k' } });
  assert.deepEqual(logged, { order: { amount: 1 } });
});

test('renewal is due within a day of the end, once a day, three times a period at most', () => {
  const now = new Date('2026-12-01T09:00:00Z');
  const base = { auto_renew: true, status: 'active', current_period_end: '2026-12-01T20:00:00Z', renewal_attempts: 0, renewal_notified_at: null };
  assert.equal(renewalDue(base, now), true);
  assert.equal(renewalDue({ ...base, current_period_end: '2026-12-04T00:00:00Z' }, now), false, 'too early');
  assert.equal(renewalDue({ ...base, auto_renew: false }, now), false);
  assert.equal(renewalDue({ ...base, status: 'expired' }, now), false);
  assert.equal(renewalDue({ ...base, renewal_attempts: 3 }, now), false);
  assert.equal(renewalDue({ ...base, renewal_notified_at: '2026-12-01T01:00:00Z' }, now), false, 'prompted 8 h ago');
  assert.equal(renewalDue({ ...base, renewal_notified_at: '2026-11-30T09:00:00Z' }, now), true, 'prompted 24 h ago');
});

test('a renewed period starts where the paid one ends, never in the past', () => {
  const now = new Date('2026-12-01T09:00:00Z');
  assert.equal(renewalStart('2026-12-03T00:00:00Z', now).toISOString(), '2026-12-03T00:00:00.000Z');
  assert.equal(renewalStart('2026-11-20T00:00:00Z', now), now);
  assert.equal(renewalStart(null, now), now);
});

test('the renewal notice names the amount, the operator, the last digits and how to stop', () => {
  const text = renewalMessage({
    channel: 'mobile_money', providerLabel: 'M-Pesa', phone: '243812345678', packageTitle: 'Standard', price: 25,
    periodEnd: '2026-12-03T00:00:00Z', manageUrl: 'https://lukkaplace.com/compte/agent/abonnement',
  });
  assert.match(text, /25 \$/);
  assert.match(text, /M-Pesa/);
  assert.match(text, /5678/);
  assert.match(text, /arrêter le renouvellement automatique : https:\/\/lukkaplace\.com\/compte\/agent\/abonnement/);
  assert.doesNotMatch(text, /243812345678/, 'never the whole number in a message');
  const card = renewalMessage({ channel: 'card', packageTitle: 'Standard', price: 25, periodEnd: '2026-12-03T00:00:00Z', checkoutUrl: 'https://lukkaplace.com/compte/agent/abonnement/payer?forfait=4', manageUrl: 'https://m' });
  assert.match(card, /payer\?forfait=4/);
});

// ---------------------------------------------------------------------------
// Flow (lib/maishapayPayments.js) — what is refused before any money moves
// ---------------------------------------------------------------------------

test('without keys nothing is created and MaishaPay is never called', async () => {
  reset();
  const saved = { pub: process.env.MAISHAPAY_PUBLIC_KEY, sec: process.env.MAISHAPAY_SECRET_KEY };
  delete process.env.MAISHAPAY_PUBLIC_KEY;
  delete process.env.MAISHAPAY_SECRET_KEY;
  try {
    const result = await startMaishapayPayment({ agentId: 1, packageId: 2, channel: 'mobile_money', provider: 'MPESA', phone: '0812345678', acceptedTerms: true });
    assert.deepEqual(result, { ok: false, error: 'not_configured' });
    assert.equal(calls.length, 0);
  } finally {
    if (saved.pub !== undefined) process.env.MAISHAPAY_PUBLIC_KEY = saved.pub;
    if (saved.sec !== undefined) process.env.MAISHAPAY_SECRET_KEY = saved.sec;
  }
});

test('with sandbox keys: a bad number, a wrong operator or unaccepted terms are refused before the database', async () => {
  process.env.MAISHAPAY_PUBLIC_KEY = 'MP-SBPK-test';
  process.env.MAISHAPAY_SECRET_KEY = 'MP-SBSK-test';
  try {
    reset();
    const base = { agentId: 1, packageId: 2, channel: 'mobile_money', provider: 'MPESA', phone: '0812345678', acceptedTerms: true };
    assert.equal((await startMaishapayPayment({ ...base, phone: '12' })).error, 'phone');
    assert.equal((await startMaishapayPayment({ ...base, provider: 'VISA' })).error, 'provider');
    assert.equal((await startMaishapayPayment({ ...base, channel: 'cash' })).error, 'channel');
    assert.equal((await startMaishapayPayment({ ...base, acceptedTerms: false })).error, 'terms');
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.MAISHAPAY_PUBLIC_KEY;
    delete process.env.MAISHAPAY_SECRET_KEY;
  }
});

test('stopping automatic renewal touches only the agent’s own agency and never the paid period', async () => {
  reset();
  await stopAutoRenew(7);
  const sql = calls.at(-1).sql;
  assert.match(sql, /a\.id = \$1 AND s\.vendor_id = a\.vendor_id/);
  assert.match(sql, /auto_renew = FALSE/);
  assert.doesNotMatch(sql, /current_period_end\s*=/);
  assert.deepEqual(calls.at(-1).values, [7]);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('the webhook settles from a status check, never from what the callback says', () => {
  const route = read('app/api/payments/maishapay/webhook/route.js');
  assert.match(route, /callbackTokenValid\(invoiceId, token\)/);
  assert.match(route, /settleInvoice\(invoiceId\)/);
  assert.doesNotMatch(route, /markPaid/);
  const settle = read('lib/maishapayPayments.js');
  assert.match(settle, /checkMaishapayTransaction\(invoice\.reference\)/);
});

test('MaishaPay keys stay server-side', () => {
  for (const file of ['lib/maishapay.js', 'lib/maishapayPayments.js', 'lib/subscriptionRenewals.js']) {
    assert.match(read(file), /^import 'server-only';/, file);
  }
  for (const file of ['components/AgentCheckout.js', 'components/PaymentStatusPanel.js', 'components/PaymentReturn.js', 'components/AgentAutoRenewCard.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /MAISHAPAY_(PUBLIC|SECRET)_KEY|from '@\/lib\/maishapay'|maishapayPayments/, file);
  }
});
