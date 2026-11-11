import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import { listMoveProjectsPage, parseMoveProjectFilters } from '@/lib/moveProjectList';
import { getMoveProjectStats } from '@/lib/moveProjectStats';

/**
 * /admin/move-projects, "Les projets" (2026-11-10): who each move project
 * belongs to. The person is the project's customer account, read as stored.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

beforeEach(() => reset());

test('filters from the URL: unknown statuses and non-numeric customers are dropped', () => {
  assert.deepEqual(parseMoveProjectFilters({}), { reason: undefined, commune: undefined, status: undefined, customer: undefined });
  assert.deepEqual(
    parseMoveProjectFilters({ reason: ' mariage ', commune: 'Kintambo', status: 'found', customer: '12' }),
    { reason: 'mariage', commune: 'Kintambo', status: 'found', customer: '12' },
  );
  const bad = parseMoveProjectFilters({ status: 'deleted', customer: '1 OR 1=1', reason: 'x'.repeat(500) });
  assert.equal(bad.status, undefined);
  assert.equal(bad.customer, undefined);
  assert.equal(bad.reason.length, 60);
});

test('one page, newest first, each project joined to its customer, filters bound as parameters', async () => {
  enqueue([
    { project_id: '7', customer_id: 3, full_name: 'Marie K.', phone: '243810000000', status: 'active', total: 4 },
    { project_id: '6', customer_id: 3, full_name: null, phone: '243810000000', status: 'found', total: 4 },
  ]);
  const page = await listMoveProjectsPage({ reason: 'mariage', commune: 'Ngaliema', status: 'active', customer: '3', limit: 25, offset: 0 });
  assert.equal(page.total, 4);
  assert.equal(page.rows.length, 2);
  assert.equal('total' in page.rows[0], false, 'the window count is not a row field');
  assert.equal(page.rows[1].full_name, null, 'no name stays no name');

  const sql = normalizeSql(calls[0].text);
  assert.match(sql, /FROM customer_move_projects p LEFT JOIN customers c ON c\.id = p\.customer_id/);
  assert.match(sql, /c\.full_name, c\.phone/);
  assert.match(sql, /\$1::text = ANY \(p\.reasons\)/);
  assert.match(sql, /\$2::text = ANY \(p\.communes\)/);
  assert.match(sql, /ORDER BY p\.created_at DESC/);
  assert.match(sql, /LIMIT \$5 OFFSET \$6/);
  assert.deepEqual(calls[0].values, ['mariage', 'Ngaliema', 'active', '3', 25, 0]);
  // Read-only, and the later-migration columns never as bare references.
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(sql, /p\.(status|manual_stage|found_at|title|budget_min)\b/);
});

test('unfiltered: every filter is NULL; past the last page the total is counted apart', async () => {
  enqueue([]);
  enqueue([{ total: 4 }]);
  const page = await listMoveProjectsPage({ limit: 25, offset: 50 });
  assert.deepEqual(calls[0].values, [null, null, null, null, 25, 50]);
  assert.equal(page.total, 4);
  assert.deepEqual(page.rows, []);
});

test('before the table exists the list is null, not an error', async () => {
  const { getPool } = await import('@/lib/db');
  const pool = getPool();
  const original = pool.query;
  pool.query = async () => { const err = new Error('relation does not exist'); err.code = '42P01'; throw err; };
  try {
    assert.equal(await listMoveProjectsPage({ limit: 25, offset: 0 }), null);
  } finally {
    pool.query = original;
  }
});

test('the stories count survives the stories rows ("Histoires partagées ()")', async () => {
  enqueue([{ projects: 4, customers: 3, active: 4, paused: 0, found: 0, settled: 0, sent: 0, stories: 2, median_days_to_found: null }]);
  enqueue([]); enqueue([]); enqueue([]);
  enqueue([{ customer_id: 1, story: 'a' }]);
  const stats = await getMoveProjectStats();
  assert.equal(stats.stories_count, 2);
  assert.equal(stats.stories.length, 1);
  assert.match(read('app/admin/move-projects/page.js'), /\(\{stats\.stories_count\}\)/);
});

test('the page links each count to the filtered list and stays behind customers.view', () => {
  const page = read('app/admin/move-projects/page.js');
  assert.match(page, /listHref\(\{ reason: row\.reason \}\)/);
  assert.match(page, /listHref\(\{ commune: row\.commune \}\)/);
  assert.match(page, /listHref\(\{ reason: row\.reason, commune: row\.commune \}\)/);
  assert.match(page, /listHref\(\{ status: 'found' \}\)/);
  assert.match(page, /id="projets"/);
  assert.match(read('lib/adminRoles.js'), /'\/admin\/move-projects': 'customers\.view'/);
  const rows = read('app/admin/move-projects/MoveProjectRows.js');
  assert.match(rows, /href=\{`tel:\+\$\{row\.phone\}`\}/);
  assert.match(rows, /\/admin\/customers\/\$\{row\.customer_id\}/);
  assert.match(rows, /admin\.moveProjects\.noName/);
  assert.match(rows, /<WhatsAppLink phone=\{row\.phone\}/, 'one tap to write to the person');
  // The people come first: the list sits above the reason and commune tables.
  assert.ok(page.indexOf('id="projets"') < page.indexOf("t('admin.moveProjects.byReason')"));
});
