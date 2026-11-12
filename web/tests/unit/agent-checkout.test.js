import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MOBILE_MONEY_OPERATORS, checkoutPath, formatUsd, initiateErrorKey, isPayableOnline, operatorById, payablePackage,
} from '@/lib/checkoutRules';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

const PACKAGES = [
  { id: 1, title: 'Free', price: 0, is_trial: 0 },
  { id: 2, title: 'Essai', price: 10, is_trial: 1 },
  { id: 3, title: 'Gold', price: 25, is_trial: 0, term: 'monthly' },
];

test('only a paid, non-trial, existing plan can be checked out', () => {
  assert.equal(payablePackage(PACKAGES, '3')?.title, 'Gold');
  assert.equal(payablePackage(PACKAGES, 3)?.title, 'Gold');
  assert.equal(payablePackage(PACKAGES, '1'), null, 'free plan');
  assert.equal(payablePackage(PACKAGES, '2'), null, 'trial');
  assert.equal(payablePackage(PACKAGES, '99'), null, 'unknown');
  assert.equal(payablePackage(PACKAGES, 'abc'), null);
  assert.equal(payablePackage(PACKAGES, undefined), null);
  assert.equal(isPayableOnline(PACKAGES[2]), true);
  assert.equal(isPayableOnline(PACKAGES[0]), false);
  assert.equal(isPayableOnline(PACKAGES[1]), false);
});

test('prices print in French format with a plain space', () => {
  assert.equal(formatUsd(25), '25 $');
  assert.equal(formatUsd(1100), '1 100 $');
  assert.equal(formatUsd('x'), '—');
});

test('the three DRC mobile-money networks, and no card', () => {
  assert.deepEqual(MOBILE_MONEY_OPERATORS.map((o) => o.id), ['mpesa', 'orange', 'airtel']);
  assert.equal(operatorById('nope').id, 'mpesa');
  assert.doesNotMatch(read('components/AgentCheckout.js'), /Abonnement automatique|Visa|Mastercard/);
});

test('every initiate error code maps to a real French message', () => {
  for (const code of ['phone', 'no_agency', 'package', 'not_configured', 'provider', 'auth', 'mystery']) {
    const key = initiateErrorKey(code).split('.');
    let node = fr;
    for (const part of key) node = node?.[part];
    assert.equal(typeof node, 'string', `${code} → ${key.join('.')}`);
  }
});

test('checkout is wired behind the same switch and FlexPaie credentials', () => {
  assert.equal(checkoutPath(3), '/compte/agent/abonnement/paiement?forfait=3');
  const page = read('app/compte/agent/abonnement/paiement/page.js');
  assert.match(page, /agentSubscriptions\) redirect\('\/compte\/agent'\)/);
  assert.match(page, /onlinePaymentOpen=\{isFlexpaieConfigured\(\)\}/);
  assert.match(page, /if \(!pkg\) redirect\('\/compte\/agent\/abonnement'\)/);
  const client = read('components/AgentCheckout.js');
  assert.match(client, /\/api\/payments\/flexpaie\/initiate/);
  assert.match(client, /\/api\/payments\/flexpaie\/status\?invoice=/);
  assert.match(read('app/compte/agent/abonnement/page.js'), /checkoutEnabled=\{checkoutEnabled\}/);
});
