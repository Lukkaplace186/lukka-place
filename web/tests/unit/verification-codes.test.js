import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CODE_LOG_KEEP_HOURS, CODE_LOG_SHOW_MINUTES, CODE_VALID_MINUTES, codePurposeKind, codeStillValid, newestPerPhone,
} from '@/lib/verificationCodeRules';
import { SECTION_PERMISSIONS, can } from '@/lib/adminRoles';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';

/*
 * /admin/codes (owner, 2026-11-24): the codes we sent, readable by the team
 * when one does not arrive.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('every sender\'s label has a name on the page; a code is valid 10 minutes', () => {
  assert.equal(codePurposeKind('customer-auth'), 'customer');
  assert.equal(codePurposeKind('agent-auth'), 'agent');
  assert.equal(codePurposeKind('reset-password'), 'reset');
  assert.equal(codePurposeKind('phone-change'), 'phoneChange');
  assert.equal(codePurposeKind('something-new'), 'other');
  const t0 = Date.parse('2026-11-24T10:00:00Z');
  assert.equal(codeStillValid('2026-11-24T10:00:00Z', t0 + 9 * 60 * 1000), true);
  assert.equal(codeStillValid('2026-11-24T10:00:00Z', t0 + CODE_VALID_MINUTES * 60 * 1000), false);
  assert.equal(CODE_LOG_SHOW_MINUTES, 60);
  assert.equal(CODE_LOG_KEEP_HOURS, 24);
  // Newest first: the first row per number is the code that counts.
  const rows = [{ id: 3, phone: 'a' }, { id: 2, phone: 'b' }, { id: 1, phone: 'a' }];
  assert.deepEqual([...newestPerPhone(rows)].sort(), [2, 3]);
  for (const kind of ['customer', 'agent', 'reset', 'phoneChange', 'other']) {
    for (const lang of ['fr', 'en']) {
      const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
      assert.ok(dict.admin.codes.purposes[kind], `${lang} ${kind}`);
    }
  }
});

test('the one sending point records every code, sent or failed, after the send and never instead of it', () => {
  const src = read('lib/otpDelivery.js');
  const wrapper = src.slice(src.indexOf('export async function sendOtpViaWhatsApp'), src.indexOf('async function deliverOtp'));
  assert.match(wrapper, /const result = await deliverOtp\(phone, code, options\);\n\s+await recordCodeSend\(\{ phone, code, purpose, status: 'sent', channel: result\?\.channel \|\| null \}\);/);
  assert.match(wrapper, /await recordCodeSend\(\{ phone, code, purpose, status: 'failed', error: err\?\.message \|\| null \}\);\n\s+throw err;/);
  const log = read('lib/verificationCodes.js');
  assert.match(log, /catch \(err\) \{\n\s+console\.error\(`\[codes\] could not record/, 'never throws into the send');
  assert.match(log, /DELETE FROM verification_codes_sent WHERE created_at < now\(\) - make_interval\(hours => \$1\)/, 'codes in clear do not pile up');
  assert.match(log, /to_regclass\('public\.verification_codes_sent'\)/, 'runs before the migration');
});

test('only owner and support open the page; every opening is audited', () => {
  assert.equal(SECTION_PERMISSIONS['/admin/codes'], 'customers.manage');
  assert.ok(can('owner', 'customers.manage'));
  assert.ok(can('support', 'customers.manage'));
  for (const role of ['moderator', 'finance', 'analyst', 'sales']) assert.ok(!can(role, 'customers.manage'), role);
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/codes'));
  const page = read('app/admin/codes/page.js');
  assert.match(page, /await recordAudit\(session, \{ action: 'codes\.view'/);
  assert.match(page, /export const dynamic = 'force-dynamic';/);
});

test('the migration is idempotent and closed to the public API', () => {
  const sql = read('../migrations/20261124_verification_codes_sent.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS verification_codes_sent/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS verification_codes_sent_created_idx/);
  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'verification_codes_sent_status_check'\)/);
  assert.match(sql, /ALTER TABLE verification_codes_sent ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON verification_codes_sent FROM anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON SEQUENCE verification_codes_sent_id_seq FROM anon, authenticated;/);
});
