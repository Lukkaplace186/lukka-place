import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DEMO_COOKIE, demoPhonesFor, isDemoPhone, notDemoAgentSql } from '@/lib/demoPhone';
import { demoSidesFromCookies, parseDemoCookie } from '@/lib/demoSession';
import { parseDemoForm } from '@/lib/demoAccounts';
import { AGENT_SESSION_COOKIE, createAgentSessionToken } from '@/lib/agentAuth';
import { CUSTOMER_SESSION_COOKIE, createCustomerSessionToken } from '@/lib/customerAuth';
import { viewerKindFor } from '@/lib/trackIngest';
import { SECTION_PERMISSIONS, can } from '@/lib/adminRoles';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

function cookieStore(values) {
  return { get: (name) => (values[name] === undefined ? undefined : { name, value: values[name] }) };
}

test('demo numbers: 243 0000 + agent 1NNNN / customer 2NNNN, never a real DRC number', () => {
  assert.deepEqual(demoPhonesFor(12), { agentPhone: '243000010012', customerPhone: '243000020012' });
  assert.equal(isDemoPhone('+243 0000 20012'), true);
  assert.equal(isDemoPhone('243812345678'), false);
  assert.equal(isDemoPhone(null), false);
  assert.match(notDemoAgentSql('a'), /a\.phone, ''\) NOT LIKE '2430000%'/);
});

test('the demo marker counts only while the signed-in session is that pair\'s own account', () => {
  assert.equal(parseDemoCookie('3.41.77').pairId, 3);
  assert.equal(parseDemoCookie('x.41.77'), null);
  assert.equal(parseDemoCookie('0.41.77'), null);

  const agentToken = createAgentSessionToken({ agentId: 41, tokenVersion: 0 });
  const customerToken = createCustomerSessionToken({ customerId: 77, tokenVersion: 1 });
  const both = demoSidesFromCookies(cookieStore({
    [DEMO_COOKIE]: '3.41.77', [AGENT_SESSION_COOKIE]: agentToken, [CUSTOMER_SESSION_COOKIE]: customerToken,
  }));
  assert.equal(both.agentSide, true);
  assert.equal(both.customerSide, true);
  assert.equal(both.phones.customerPhone, '243000020003');

  // A stale marker beside a real login changes nothing.
  const realCustomer = createCustomerSessionToken({ customerId: 5, tokenVersion: 1 });
  assert.equal(demoSidesFromCookies(cookieStore({ [DEMO_COOKIE]: '3.41.77', [CUSTOMER_SESSION_COOKIE]: realCustomer })), null);
  assert.equal(demoSidesFromCookies(cookieStore({ [CUSTOMER_SESSION_COOKIE]: customerToken })), null);
});

test('the create form: a label is required, the copy number is a real 7–15 digit number and never a demo one', () => {
  const form = (entries) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };
  assert.equal(parseDemoForm(form({ label: '  ' })).ok, false);
  const ok = parseDemoForm(form({ label: 'Parcours visite', deliver_to: '+243 812 345 678' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.values.deliverTo, '243812345678');
  assert.equal(ok.values.customerName, 'Client démo');
  assert.equal(ok.values.agencyName, 'Agence démo — Parcours visite');
  assert.equal(parseDemoForm(form({ label: 'x', deliver_to: '243000010001' })).errorKey, 'admin.demo.errorPhone');
  assert.equal(parseDemoForm(form({ label: 'x', deliver_to: '12' })).errorKey, 'admin.demo.errorPhone');
});

test('a demo browser counts as staff in page views and taps', () => {
  const request = { headers: { get: () => null, cookie: undefined }, cookies: { get: (n) => (n === DEMO_COOKIE ? { value: '3.41.77' } : undefined) } };
  assert.equal(viewerKindFor(request, 'mobile'), 'staff');
});

test('the console page is owner/support only and in the sidebar', () => {
  assert.equal(SECTION_PERMISSIONS['/admin/demo'], 'accounts.demo');
  assert.equal(can('owner', 'accounts.demo'), true);
  assert.equal(can('support', 'accounts.demo'), true);
  assert.equal(can('analyst', 'accounts.demo'), false);
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/demo'));
});

test('demo accounts never cross over: forms, chat, favourites, payments, phone change, account deletion, ads', () => {
  for (const file of [
    'app/(site)/listings/[id]/actions.js',
    'app/(site)/listings/visitBatchActions.js',
    'app/(site)/trouver-pour-moi/actions.js',
    'app/(portfolio)/agents/[id]/actions.js',
    'app/(site)/projets/[slug]/actions.js',
  ]) {
    assert.match(read(file), /const phone = await demoCustomerPhoneOr\(phoneFromForm\(formData\)\);/, file);
  }
  const chat = read('lib/chat.js');
  assert.match(chat, /if \(isDemoPhone\(customer\.phone\)\)[\s\S]{0,300}FROM demo_accounts d JOIN agents a/);
  assert.match(chat, /else if \(isDemoPhone\(agent\.phone\)\) \{\s*return \{ status: 'agent-unavailable' \};/);
  assert.match(read('lib/analytics.js'), /customer_favorites f[\s\S]{0,200}c\.phone LIKE '2430000%'/);
  assert.match(read('app/api/payments/maishapay/initiate/route.js'), /getDemoPairForAgent\(agentId\)\) return NextResponse\.json\(\{ error: 'demo' \}/);
  assert.match(read('lib/customerPhoneChange.js'), /isDemoPhone\(own\[0\]\.phone\) \|\| isDemoPhone\(phone\)\) return \{ ok: false, error: 'demo' \}/);
  assert.match(read('app/(site)/compte/actions.js'), /if \(await isDemoCustomer\(customerId\)\) redirect/);
  assert.match(read('lib/adServerContext.js'), /if \(isDemoPhone\(phone\)\) return;/);
  assert.match(read('lib/adminApi.js'), /\.\.\.\(demo \? \{ 'x-lukka-demo': demo \} : \{\}\)/);
});

test('the purge only ever deletes a demo pair\'s own rows', () => {
  const src = read('lib/demoAccounts.js');
  assert.match(src, /if \(rows\[0\] && !isDemoPhone\(rows\[0\]\.phone\)\) throw new Error\(`agent #\$\{pair\.agentId\} is not a demo agent`\)/);
  assert.match(src, /if \(rows\[0\] && !isDemoPhone\(rows\[0\]\.phone\)\) throw new Error\(`customer #\$\{pair\.customerId\} is not a demo customer`\)/);
  assert.match(src, /is_test, created_at, updated_at\)\s*VALUES \(\$1, \$2, 1, \$3, NOW\(\), 'demo', true/);
});
