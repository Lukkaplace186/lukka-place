import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { deleteAgentAccount, getAgentDeletionImpact } from '@/lib/adminAgentDeletion';
import { deletePackage, readPhotoAllowance } from '@/lib/subscriptions';
import { toCsv, withEngagement, EXCEL_CSV_OPTIONS, LISTING_EXPORT_COLUMNS } from '@/lib/dataExport';
import { photoPerkLines } from '@/lib/photoAllowance';
import { agentContactName, agentPublicName } from '@/lib/agencies';
import { AGENCY_NAME_EXPR } from '@/lib/listings';
import { can } from '@/lib/adminRoles';

/**
 * Admin deletions (agents, packages), the market-data export's engagement
 * columns, photography allowances, and the agency / contact name split.
 * The deletions were also dry-run against the production schema (every
 * statement, then ROLLBACK); these pin the rules.
 */

beforeEach(() => reset());

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sqlOf = (pattern) => calls.find((call) => pattern.test(call.sql));

// --- agent deletion ------------------------------------------------------------

test('only the owner role may delete an agent', () => {
  assert.equal(can('owner', 'agents.delete'), true);
  for (const role of ['moderator', 'support', 'finance', 'analyst', 'sales']) assert.equal(can(role, 'agents.delete'), false, role);
});

test('an agent with a commission still owed or paid is never deleted', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 5, phone: '243' }]); // SELECT … FOR UPDATE
  enqueue([{ n: 2 }]); // commissions still owed or paid
  const result = await deleteAgentAccount(5);
  assert.deepEqual(result, { ok: false, reason: 'commissions', count: 2 });
  assert.ok(!calls.some((call) => /DELETE FROM agents/.test(call.sql)), 'nothing deleted');
  assert.ok(calls.some((call) => call.sql.trim() === 'ROLLBACK'));
});

test('"delete" mode never deletes a closed transaction — it is archived and detached', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 5, phone: '243' }]);
  enqueue([{ n: 0 }]);
  enqueue([]); // documents
  enqueue([{ id: 11 }]); // listings to delete
  const result = await deleteAgentAccount(5, { listings: 'delete', dryRun: true });
  assert.equal(result.ok, true);
  assert.match(sqlOf(/SELECT id FROM properties/).sql, /listing_status IS DISTINCT FROM 'closed'/);
  assert.match(sqlOf(/UPDATE properties\s+SET agent_id = NULL/).sql, /status = 0/);
  for (const table of ['property_slider_images', 'property_contents', 'wishlists', 'saved_search_notifications']) {
    assert.ok(calls.some((call) => new RegExp(`DELETE FROM ${table} WHERE property_id`).test(call.sql)), table);
  }
  assert.ok(calls.some((call) => call.sql.trim() === 'ROLLBACK'), 'dry run rolls back');
  assert.ok(!calls.some((call) => call.sql.trim() === 'COMMIT'));
});

test('agent deletion clears the rows with no foreign key and keeps the audit trails', () => {
  const src = read('lib/adminAgentDeletion.js');
  for (const stmt of [
    'DELETE FROM agent_infos WHERE agent_id',
    'DELETE FROM plan_change_requests WHERE agent_id',
    'UPDATE whatsapp_clicks SET agent_id = NULL',
    'UPDATE projects SET agent_id = NULL',
  ]) assert.ok(src.includes(stmt), stmt);
  assert.doesNotMatch(src, /DELETE FROM sales_commissions|DELETE FROM sales_attribution_changes/);
  // ID documents leave the bucket only after the commit.
  assert.ok(src.indexOf("await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')") < src.indexOf('removeVerificationFiles(storagePaths)'));
});

test('the impact query reports what the dialog shows', async () => {
  enqueue([{ id: '5', phone: '243', name: 'Agence', listings: 3, live_listings: 2, closed_listings: 1, documents: 2, blocking_commissions: 0 }]);
  assert.deepEqual(await getAgentDeletionImpact(5), {
    id: 5, name: 'Agence', phone: '243', listings: 3, liveListings: 2, closedListings: 1, documents: 2, blockingCommissions: 0,
  });
});

test('the delete action demands the typed id and is audited', () => {
  const src = read('app/admin/agents/actions.js');
  assert.match(src, /requireAdmin\('agents\.delete'\)/);
  assert.match(src, /formData\.get\('confirm_id'\)/);
  assert.match(src, /action: 'agent\.delete'/);
});

// --- ids come from the sequence -------------------------------------------------

test('packages and WhatsApp-onboarded agents take ids from the identity sequence', () => {
  assert.doesNotMatch(read('lib/subscriptions.js'), /nextId\(pool, 'packages'\)/);
  const engine = readFileSync(path.join(process.cwd(), '../services/agentOnboarding.js'), 'utf8');
  assert.doesNotMatch(engine, /COALESCE\(MAX\(id\), 0\) \+ 1 AS id FROM agents/);
});

// --- package deletion -------------------------------------------------------------

test('the Free plan cannot be deleted', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 29 }]);
  enqueue([{ id: 29, title: 'Free', term: 'lifetime' }]);
  assert.deepEqual(await deletePackage(29), { ok: false, reason: 'is_default' });
});

test('active memberships move to Free as NEW rows; the paid row is ended, never rewritten', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 26 }]);
  enqueue([{ id: 29, title: 'Free', term: 'lifetime' }]);
  enqueue([{ id: 40, vendor_id: 997 }]); // one active membership
  enqueue([]); // end it
  enqueue([{ id: 53 }]); // nextId
  enqueue([]); // insert
  enqueue([]); // decline requests
  enqueue([{ n: 12 }]); // references
  const result = await deletePackage(26, { dryRun: true });
  assert.deepEqual(result, { ok: true, mode: 'archived', moved: 1, declined: 0, dryRun: true });
  assert.match(sqlOf(/UPDATE memberships SET expire_date = NOW\(\)/).sql, /WHERE id = \$1/);
  assert.ok(!calls.some((call) => /UPDATE memberships SET package_id/.test(call.sql)), 'history is not rewritten');
  const insert = sqlOf(/INSERT INTO memberships/);
  assert.equal(insert.values[1], 29);
  assert.equal(insert.values[2], 997);
  assert.match(sqlOf(/UPDATE packages SET deleted_at = NOW\(\)/).sql, /status = 0/);
});

test('a package nobody ever held is deleted outright; deleted packages leave every list', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 32 }]);
  enqueue([{ id: 29, title: 'Free', term: 'lifetime' }]);
  enqueue([]); // no active memberships
  enqueue([]); // decline
  enqueue([{ n: 0 }]);
  const result = await deletePackage(32, { dryRun: true });
  assert.equal(result.mode, 'deleted');
  assert.ok(calls.some((call) => /DELETE FROM packages WHERE id = \$1/.test(call.sql)));
  const src = read('lib/subscriptions.js');
  assert.match(src, /WHERE p\.deleted_at IS NULL/);
  assert.match(src, /WHERE status = 1 AND deleted_at IS NULL/);
});

test('photo allowances are clamped whole numbers, and a zero perk prints nothing', () => {
  assert.deepEqual(readPhotoAllowance('2', '15'), { photoSessions: 2, photoDiscountPct: 15 });
  assert.deepEqual(readPhotoAllowance('-4', '250'), { photoSessions: 0, photoDiscountPct: 100 });
  assert.deepEqual(readPhotoAllowance('', 'abc'), { photoSessions: 0, photoDiscountPct: 0 });
  const t = (key, vars) => `${key}:${JSON.stringify(vars || {})}`;
  assert.deepEqual(photoPerkLines({ sessions: 0, discountPct: 0 }, t), []);
  assert.deepEqual(photoPerkLines({ sessions: 1, discountPct: 0 }, t), ['agent.plans.photoSessionsOne:{"count":1}']);
  assert.deepEqual(photoPerkLines({ sessions: 3, discountPct: 20 }, t), [
    'agent.plans.photoSessionsMany:{"count":3}',
    'agent.plans.photoDiscount:{"pct":20}',
  ]);
});

// --- market-data export -------------------------------------------------------------

test('the export appends engagement columns — never inserts — and leaves visits empty when unknown', () => {
  const tail = LISTING_EXPORT_COLUMNS.slice(-4);
  assert.deepEqual(tail, ['verified_at', 'views_total', 'whatsapp_clicks_total', 'visit_requests_total']);
  const rows = [{ property_id: 305 }, { property_id: 7 }];
  const stats = { views: { 305: 43 }, clicks: { 305: 2 } };
  assert.deepEqual(withEngagement(rows, stats, new Map([[305, 1]])).map((r) => [r.views_total, r.whatsapp_clicks_total, r.visit_requests_total]), [[43, 2, 1], [0, 0, 0]]);
  assert.equal(withEngagement(rows, stats, null)[0].visit_requests_total, null);
});

test('the Excel flavour is semicolon-separated, keeps the BOM, and quotes a value holding a semicolon', () => {
  const csv = toCsv([{ a: 'Gombe; Ngaliema', b: 'Kalamu, Yolo' }], ['a', 'b'], EXCEL_CSV_OPTIONS);
  assert.ok(csv.startsWith('﻿a;b\r\n'));
  assert.ok(csv.includes('"Gombe; Ngaliema";Kalamu, Yolo'));
  assert.ok(toCsv([{ a: 'x;y' }], ['a']).includes('x;y'), 'a comma CSV does not need to quote a semicolon');
});

test('the export route adds engagement and still answers when the engine does not', () => {
  const src = read('app/admin/export/listings.csv/route.js');
  assert.match(src, /countViewingRequestsByProperty\(\)\.catch/);
  assert.match(src, /format'\) === 'excel'/);
  assert.match(read('app/admin/market-data/page.js'), /can\(session\?\.role, 'data\.export'\)/);
});

// --- agency / contact names -------------------------------------------------------------

test('the public heading is the agency name when given, the person otherwise', () => {
  const agent = { agency_name: 'Espace Kin Immobilier', first_name: 'Jean', last_name: 'Dupont', username: '243999' };
  assert.equal(agentPublicName(agent), 'Espace Kin Immobilier');
  assert.equal(agentContactName(agent), 'Jean Dupont');
  assert.equal(agentPublicName({ first_name: 'Jean', last_name: 'Dupont' }), 'Jean Dupont');
  assert.equal(agentContactName({ agency_name: 'Kkimmo', first_name: 'Kkimmo' }), null, 'same name is not repeated');
  // The storefront's name expression reads the agency first.
  assert.ok(AGENCY_NAME_EXPR.indexOf('a.agency_name') < AGENCY_NAME_EXPR.indexOf('ai.first_name'));
});

test('signup asks for the agency and the contact separately, and stores them in different places', () => {
  const page = read('app/(site)/compte/agent/inscription/page.js');
  assert.match(page, /name="agency_name"/);
  assert.match(page, /name="contact_name"/);
  assert.doesNotMatch(page, /name="full_name"/);
  const action = read('app/(site)/compte/agent/inscription/actions.js');
  assert.match(action, /agencyName: agencyName \|\| undefined/);
  assert.match(read('lib/agencies.js'), /UPDATE agents SET agency_name = \$1/);
});
