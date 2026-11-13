import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listModerationQueue } from '@/lib/moderationQueue';
import { partnerSql } from '@/lib/partnerAgencies';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

/**
 * Partner agencies (owner, 2026-11-13): JOKER AGENCY first. The approval queue
 * shows their listings apart (?partner=only|none) and badges each one.
 */

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('a partner listing is one whose agent belongs to a marked agency', () => {
  assert.equal(
    partnerSql('a'),
    'EXISTS (SELECT 1 FROM partner_agencies pag WHERE pag.vendor_id = a.vendor_id)',
  );
});

test('?partner=only and none filter the queue, and every row says whether it is a partner', async () => {
  reset();
  // to_regclass checks: listing_availability_checks, then partner_agencies.
  enqueue([{ ok: true }]);
  enqueue([{ ok: true }]);
  await listModerationQueue({ status: 'pending', partner: 'only' });
  const page = calls.map((c) => normalizeSql(c.text ?? c.sql)).find((sql) => sql.includes('LIMIT $'));
  assert.ok(page, 'the page query ran');
  assert.ok(page.includes('AND EXISTS (SELECT 1 FROM partner_agencies pag WHERE pag.vendor_id = a.vendor_id)'), 'only partners');
  assert.ok(page.includes('EXISTS (SELECT 1 FROM partner_agencies pag WHERE pag.vendor_id = a.vendor_id) AS agent_partner'));

  reset();
  await listModerationQueue({ status: 'approved', partner: 'none' });
  const none = calls.map((c) => normalizeSql(c.text ?? c.sql)).find((sql) => sql.includes('LIMIT $'));
  assert.ok(none.includes('AND NOT EXISTS (SELECT 1 FROM partner_agencies pag'), 'everyone but partners');

  reset();
  await listModerationQueue({ status: 'pending', partner: 'everyone; DROP' });
  const ignored = calls.map((c) => normalizeSql(c.text ?? c.sql)).find((sql) => sql.includes('LIMIT $'));
  assert.ok(!ignored.includes('AND EXISTS (SELECT 1 FROM partner_agencies') && !ignored.includes('AND NOT EXISTS (SELECT 1 FROM partner_agencies'), 'an unknown value filters nothing');
});

test('before the migration the queue never names the table', () => {
  const lib = read('lib/moderationQueue.js');
  assert.match(lib, /\$\{partners \? partnerSql\('a'\) : 'false'\} AS agent_partner/);
  assert.match(lib, /if \(partners && partner === 'only'\)/);
  const partnersLib = read('lib/partnerAgencies.js');
  assert.match(partnersLib, /to_regclass\('public\.partner_agencies'\)/);
});

test('the migration is idempotent and closed to the anon key', () => {
  const sql = fs.readFileSync(path.join(root, '..', 'migrations', '20261113_partner_agencies.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS partner_agencies/);
  assert.match(sql, /vendor_id\s+bigint PRIMARY KEY/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON partner_agencies FROM anon, authenticated/);
});

test('the console wires it: agency toggle, queue filter row, badge, export', () => {
  const action = read('app/admin/agencies/[id]/partnerActions.js');
  assert.match(action, /requireAdmin\('agents\.manage'\)/);
  assert.match(action, /recordAudit\(session, \{ action: on \? 'agency\.partner_on' : 'agency\.partner_off'/);
  assert.match(read('app/admin/agencies/[id]/page.js'), /<PartnerToggle vendorId=\{agency\.id\} partner=\{partner\} \/>/);
  const page = read('app/admin/listings/page.js');
  assert.match(page, /partner: PARTNER_FILTERS\.includes\(firstParam\(raw\.partner\)\)/);
  assert.match(page, /listPartnerAgencies\(\)/);
  assert.match(read('app/admin/listings/ModerationCells.js'), /row\.agentPartner \? <Chip tone="blue">/);
  assert.match(read('app/admin/export/[dataset]/route.js'), /partner: p\.get\('partner'\)/);
});
