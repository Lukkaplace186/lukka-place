import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHref, decodeCursor, encodeCursor, keysetClause, pageCursors, parseCursor,
} from '@/lib/adminPagination';
import { listAuditLog } from '@/lib/adminAudit';
import { listModerationQueue } from '@/lib/moderationQueue';
import { listAgentsForAdmin } from '@/lib/agents';
import { adminListCustomersPage } from '@/lib/customers';
import { archiveAgencyBranch, assignAgentsToBranch, createAgencyBranch } from '@/lib/adminBranches';
import { receiptNumber } from '@/lib/adminBilling';
import { calls, enqueue, reset } from '../support/fakePool.js';

test.beforeEach(() => reset());

const TS = '2026-09-14 10:00:00.123456+00';

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

test('a cursor round-trips with microsecond precision intact', () => {
  const encoded = encodeCursor([TS, 42]);
  assert.deepEqual(decodeCursor(encoded), [TS, '42']);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, 'base64url: safe in a query string without escaping');
});

test('anything that is not a cursor this module wrote is refused', () => {
  const forge = (value) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  assert.equal(decodeCursor('not base64 at all!'), null);
  assert.equal(decodeCursor(forge(["1'; DROP TABLE agents; --", '1'])), null, 'the sort value must look like a timestamp');
  assert.equal(decodeCursor(forge([TS, '1 OR 1=1'])), null, 'the id must be digits');
  assert.equal(decodeCursor(forge([TS])), null);
  assert.equal(decodeCursor('x'.repeat(500)), null);
  assert.deepEqual(decodeCursor(forge(['-infinity', '7'])), ['-infinity', '7'], 'a NULL created_at sorts as -infinity');
});

test('parseCursor reads after/before from the query string, after first', () => {
  const after = encodeCursor([TS, 1]);
  const before = encodeCursor([TS, 2]);
  assert.deepEqual(parseCursor({ after, before }), { direction: 'after', values: [TS, '1'] });
  assert.deepEqual(parseCursor({ before }), { direction: 'before', values: [TS, '2'] });
  assert.equal(parseCursor({ page: '3' }), null);
});

test('keysetClause seeks the right way for each direction and order', () => {
  const key = { ts: 't.created_at', id: 't.id' };
  const after = { direction: 'after', values: [TS, '5'] };
  const before = { direction: 'before', values: [TS, '5'] };

  const newestNext = keysetClause(after, { ...key, descending: true }, 3);
  assert.equal(newestNext.condition, '(t.created_at, t.id) < ($3, $4)');
  assert.equal(newestNext.orderBy, 't.created_at DESC, t.id DESC');
  assert.equal(newestNext.reverse, false);

  const newestPrev = keysetClause(before, { ...key, descending: true }, 1);
  assert.equal(newestPrev.condition, '(t.created_at, t.id) > ($1, $2)');
  assert.equal(newestPrev.orderBy, 't.created_at ASC, t.id ASC');
  assert.equal(newestPrev.reverse, true, 'a previous page is scanned backwards and flipped');

  assert.equal(keysetClause(after, { ...key, descending: false }, 1).condition, '(t.created_at, t.id) > ($1, $2)');
  assert.equal(keysetClause(before, { ...key, descending: false }, 1).orderBy, 't.created_at DESC, t.id DESC');
  assert.equal(keysetClause(null, { ...key, descending: true }, 1).condition, null);
});

test('a filter change or a numbered page drops the cursor; the arrow that sets one keeps it', () => {
  const params = { q: 'gombe', page: 4, after: 'abc' };
  assert.equal(buildHref('/admin/audit', params, { q: 'limete' }), '/admin/audit?q=limete');
  assert.equal(buildHref('/admin/audit', params, { page: 9 }), '/admin/audit?q=gombe&page=9');
  assert.equal(buildHref('/admin/audit', { q: 'gombe' }, { page: 5, after: 'xyz' }), '/admin/audit?q=gombe&page=5&after=xyz');
});

test('pageCursors points next at the last row and prev at the first', () => {
  const cursors = pageCursors([{ id: 9, cursor_ts: 'b' }, { id: 3, cursor_ts: 'a' }]);
  assert.equal(cursors.next, encodeCursor(['a', 3]));
  assert.equal(cursors.prev, encodeCursor(['b', 9]));
  assert.deepEqual(pageCursors([]), { next: null, prev: null });
});

// ---------------------------------------------------------------------------
// Keyset in the list queries
// ---------------------------------------------------------------------------

function pageQuery(fragment) {
  return calls.find((c) => c.sql.includes(fragment) && /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
}

test('the audit log seeks by cursor instead of offsetting, and flips a previous page back into order', async () => {
  enqueue([{ total: 3 }]);
  enqueue([{ id: 7, cursor_ts: 'a' }, { id: 8, cursor_ts: 'b' }]);
  const result = await listAuditLog({ entityType: 'listing', offset: 500, cursor: { direction: 'before', values: [TS, '6'] } });
  const page = pageQuery('FROM console_admin_audit_log l LEFT JOIN');
  assert.ok(page.sql.includes('l.entity_type = $1 AND (l.created_at, l.id) > ($2, $3)'));
  assert.ok(page.sql.includes('ORDER BY l.created_at ASC, l.id ASC'));
  assert.equal(page.values.at(-1), 0, 'a cursor page never also offsets');
  assert.deepEqual(result.rows.map((r) => r.id), [8, 7]);
  assert.equal(result.cursors.next, encodeCursor(['a', 7]));
  const count = calls.find((c) => c.sql.startsWith('SELECT COUNT(*)::int AS total FROM console_admin_audit_log'));
  assert.ok(!count.sql.includes('l.created_at, l.id'), 'the total counts the whole filter, not what is left after the cursor');
});

test('customers page by (created_at, id) newest first', async () => {
  await adminListCustomersPage({ status: 'locked', cursor: { direction: 'after', values: [TS, '11'] } });
  const page = pageQuery('FROM customers c');
  assert.ok(page.sql.includes('c.locked_until > NOW() AND (c.created_at, c.id) < ($1, $2)'));
  assert.ok(page.sql.includes('ORDER BY c.created_at DESC, c.id DESC'));
});

test('the moderation queue keysets its time orders and ignores a cursor on a price order', async () => {
  await listModerationQueue({ status: 'pending', cursor: { direction: 'after', values: [TS, '4'] } });
  let page = pageQuery('FROM flagged f');
  assert.ok(page.sql.includes('(f.created_at, f.id) > ('), 'pending is oldest first, so "after" means later');
  assert.ok(page.sql.includes('ORDER BY f.created_at ASC, f.id ASC'));

  reset();
  const priced = await listModerationQueue({ status: 'approved', sort: 'price_desc', offset: 50, cursor: { direction: 'after', values: [TS, '4'] } });
  page = pageQuery('FROM flagged f');
  assert.ok(!page.sql.includes('f.created_at, f.id) '), 'a price order is not a timestamp order a cursor can seek');
  assert.ok(page.sql.includes('ORDER BY f.price DESC NULLS LAST, f.id DESC'));
  assert.equal(page.values.at(-1), 50, 'so it keeps paging by offset');
  assert.equal(priced.cursors, null);
});

test('agents keyset only on newest, with a NULL created_at sorted last', async () => {
  await listAgentsForAdmin({ cursor: { direction: 'after', values: ['-infinity', '3'] } });
  let page = pageQuery('FROM agents a');
  assert.ok(page.sql.includes("(COALESCE(a.created_at, '-infinity'), a.id) < ("));
  assert.ok(page.sql.includes("ORDER BY COALESCE(a.created_at, '-infinity') DESC, a.id DESC"));

  reset();
  const byListings = await listAgentsForAdmin({ sort: 'listings', cursor: { direction: 'after', values: [TS, '3'] } });
  page = pageQuery('FROM agents a');
  assert.ok(page.sql.includes('ORDER BY listing_count DESC, a.id DESC'));
  assert.equal(byListings.cursors, null);
});

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

test('the branch filter only counts live branches of the agent\'s CURRENT agency', async () => {
  await listAgentsForAdmin({ vendorId: 7, branchId: 'none', withBranch: true });
  const count = calls.find((c) => c.sql.startsWith('SELECT COUNT(*)::int AS total'));
  assert.ok(count.sql.includes('NOT EXISTS (SELECT 1 FROM agency_branch_agents ba JOIN agency_branches b ON b.id = ba.branch_id AND b.archived_at IS NULL AND b.vendor_id = a.vendor_id'));
  assert.ok(pageQuery('FROM agents a').sql.includes('AS branch_name'));

  reset();
  await listAgentsForAdmin({ vendorId: 7, branchId: '3; DROP TABLE agents' });
  assert.ok(!calls.some((c) => c.sql.includes('agency_branch_agents')), 'a non-numeric branch id is ignored, never interpolated');
});

test('assigning agents is scoped to the agency in SQL and to a live branch of it', async () => {
  enqueue([{ agent_id: 5 }]);
  const result = await assignAgentsToBranch({ vendorId: 7, branchId: 3, agentIds: [5, '5', -1, 'x', 9] });
  const insert = calls[0];
  assert.ok(insert.sql.includes('JOIN agency_branches b ON b.id = $2 AND b.vendor_id = a.vendor_id AND b.archived_at IS NULL'));
  assert.ok(insert.sql.includes('WHERE a.vendor_id = $1 AND a.id = ANY($3::bigint[])'));
  assert.deepEqual(insert.values[2], [5, 9], 'ids are de-duplicated and junk dropped');
  assert.deepEqual(result.changedIds, [5], 'the result is what really changed, not what was asked');
});

test('removing agents from their branch cannot reach another agency\'s agents', async () => {
  await assignAgentsToBranch({ vendorId: 7, branchId: null, agentIds: [5] });
  assert.ok(calls[0].sql.startsWith('DELETE FROM agency_branch_agents ba USING agents a WHERE ba.agent_id = a.id AND a.vendor_id = $1'));
});

test('archiving a branch releases its agents in the same transaction', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 3 }]); // UPDATE … archived_at
  enqueue([]); // DELETE memberships
  enqueue([]); // COMMIT
  await archiveAgencyBranch({ vendorId: 7, branchId: 3 });
  assert.deepEqual(calls.map((c) => c.sql.split(' ')[0]), ['BEGIN', 'UPDATE', 'DELETE', 'COMMIT']);
  assert.ok(calls[1].sql.includes('WHERE id = $2 AND vendor_id = $1 AND archived_at IS NULL'));

  reset();
  enqueue([]); // BEGIN
  enqueue([]); // UPDATE matched nothing: another agency's branch, or already archived
  const missing = await archiveAgencyBranch({ vendorId: 8, branchId: 3 });
  assert.equal(missing.errorKey, 'admin.branches.notFound');
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.sql.startsWith('DELETE')));
});

test('a duplicate live branch name is reported, not thrown', async () => {
  enqueue([{ '?column?': 1 }]); // vendor exists
  enqueue([]); // ON CONFLICT DO NOTHING returned nothing
  const result = await createAgencyBranch({ vendorId: 7, name: 'Gombe' });
  assert.equal(result.errorKey, 'admin.branches.duplicate');
  assert.ok(calls[1].sql.includes('ON CONFLICT (vendor_id, LOWER(name)) WHERE archived_at IS NULL DO NOTHING'));
});

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

test('a receipt number is derived from the ledger row, in Kinshasa\'s year', () => {
  assert.equal(receiptNumber({ id: 42, created_at: '2026-03-01T10:00:00Z' }), 'LP-2026-000042');
  assert.equal(receiptNumber({ id: 42, created_at: '2026-12-31T23:30:00Z' }), 'LP-2027-000042', '23:30 UTC is already next year in Kinshasa');
  assert.equal(receiptNumber({ id: 1234567, created_at: null }), 'LP-0000-1234567');
});
