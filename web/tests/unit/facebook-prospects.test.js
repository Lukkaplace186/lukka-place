import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOBILE_PREFIXES, cleanPostUrl, extractCongoPhones } from '@/lib/facebookLeadParser';
import { KNOWN_AGENT_PHONES_SQL, UPSERT_PROSPECT_SQL, listRecentFacebookProspects, recordFacebookProspects } from '@/lib/facebookProspects';
import { sectionPermission } from '@/lib/adminRoles';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

test.beforeEach(() => reset());

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

test('every DRC mobile operator prefix is accepted', () => {
  assert.deepEqual(MOBILE_PREFIXES, ['80', '81', '82', '83', '84', '85', '89', '90', '91', '97', '98', '99']);
  assert.deepEqual(
    extractCongoPhones('0801234567 0831234567 0911234567 0981234567'),
    ['+243801234567', '+243831234567', '+243911234567', '+243981234567'],
  );
});

test('every written shape of a number normalises to +243XXXXXXXXX', () => {
  const cases = [
    ['Appelez 0812345678', ['+243812345678']],
    ['+243 81 234 5678 ou 099-123-45-67', ['+243812345678', '+243991234567']],
    ['(+243) 812345678', ['+243812345678']],
    ['+243 (0) 85.123.4567', ['+243851234567']],
    ['00243 90 123 4567', ['+243901234567']],
    ['wa.me/243971234567', ['+243971234567']],
    ['0812345678/0998765432', ['+243812345678', '+243998765432']],
    ['tel 082 123 45 67, loyer 1200$', ['+243821234567']],
    ['Orange 0841234567 · 0891234567', ['+243841234567', '+243891234567']],
  ];
  for (const [text, expected] of cases) assert.deepEqual(extractCongoPhones(text), expected, text);
});

test('a number is listed once however often it appears', () => {
  assert.deepEqual(extractCongoPhones('0812345678 ... +243 812 345 678'), ['+243812345678']);
});

test('prices, longer digit runs and other prefixes are not numbers', () => {
  for (const text of [
    'Prix 850 000 000 FC', // bare nine digits: a price
    '1243812345678', // inside a longer run
    '+2438123456789', // one digit too many
    '0861234567', // 086 is no operator's
    '0812\n345678', // a line break never joins two halves
    '',
  ]) assert.deepEqual(extractCongoPhones(text), [], text);
  assert.deepEqual(extractCongoPhones(null), []);
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

test('agents are matched on folded digits, prospects are upserted by phone', () => {
  const agents = normalizeSql(KNOWN_AGENT_PHONES_SQL);
  assert.ok(agents.includes("regexp_replace(phone, '[^0-9]', '', 'g')"));
  assert.ok(agents.includes("WHEN d ~ '^0[0-9]{9}$' THEN '243' || substring(d from 2)"), 'a local 0812… agent phone still matches');
  assert.ok(!/deleted_at/.test(agents), 'a deleted agent is still a known number');
  const upsert = normalizeSql(UPSERT_PROSPECT_SQL);
  assert.ok(upsert.includes('INSERT INTO facebook_prospects'));
  assert.ok(upsert.includes('ON CONFLICT (phone) DO UPDATE'));
  assert.ok(upsert.includes('(xmax = 0) AS inserted'));
});

test('known agents and our own numbers are skipped, new numbers stored digits-only', async () => {
  enqueue([{ phone: '243821234567' }]); // agent lookup
  enqueue([{ id: 1, inserted: true }]); // +243812345678
  enqueue([{ id: 2, inserted: false }]); // +243991234567, seen before
  const result = await recordFacebookProspects({
    phones: ['+243976321848', '+243812345678', '+243821234567', '+243991234567'],
    authorName: '  Jean Immo ',
    groupName: 'Maisons à louer Kinshasa',
    postUrl: 'https://www.facebook.com/groups/1/posts/2',
    postText: 'Appartement à Limete',
  });
  assert.deepEqual(result.created, ['+243812345678']);
  assert.deepEqual(result.skipped, [
    { phone: '+243976321848', reason: 'ours' },
    { phone: '+243821234567', reason: 'agent' },
    { phone: '+243991234567', reason: 'already_prospect' },
  ]);
  assert.deepEqual(calls[0].values, [['243812345678', '243821234567', '243991234567']], 'our number never reaches the database');
  assert.deepEqual(calls[1].values, ['243812345678', 'Jean Immo', 'Maisons à louer Kinshasa', 'https://www.facebook.com/groups/1/posts/2', 'Appartement à Limete']);
  assert.equal(calls.length, 3);
});

test('only our own numbers: no query at all', async () => {
  const result = await recordFacebookProspects({ phones: ['+243846962654'] });
  assert.deepEqual(result, { created: [], skipped: [{ phone: '+243846962654', reason: 'ours' }] });
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Route, migration, export
// ---------------------------------------------------------------------------

test('the ingest route has its own secret and refuses when it is unset', () => {
  const route = read('../../app/api/ingest/facebook-lead/route.js');
  assert.ok(route.includes('process.env.FACEBOOK_INGEST_SECRET'));
  assert.ok(!route.includes('process.env.CRON_SECRET'),'a leaked ingest key must not open the cron routes');
  assert.ok(route.includes('if (!expected) return false;'));
  assert.ok(route.includes('crypto.timingSafeEqual'));
});

test('the table is closed to PostgREST and separate from customer leads', () => {
  const sql = read('../../../migrations/20261023_facebook_prospects.sql');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS facebook_prospects'));
  assert.ok(sql.includes("CHECK (phone ~ '^243[0-9]{9}$')"));
  assert.ok(sql.includes("DEFAULT 'pending_invite'"));
  assert.ok(sql.includes("DEFAULT 'facebook_group'"));
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('REVOKE ALL ON facebook_prospects FROM anon, authenticated'));
});

test('the export lists pending invites only, with the five columns', () => {
  const script = read('../../scripts/export-facebook-leads.mjs');
  assert.ok(script.includes("WHERE status = 'pending_invite'"));
  assert.ok(script.includes("'Phone,Author,Group,Post URL,Date Extracted'"));
  assert.ok(!/UPDATE\s+facebook_prospects/i.test(script), 'exporting never marks anyone invited');
  const pkg = JSON.parse(read('../../package.json'));
  assert.equal(pkg.scripts['export:leads'], 'node scripts/export-facebook-leads.mjs');
});

// ---------------------------------------------------------------------------
// "Coller une publication" (/admin/prospects/paste)
// ---------------------------------------------------------------------------

test('the paste page is agents.manage, re-parses on the server and audits counts only', () => {
  assert.equal(sectionPermission('/admin/prospects/paste'), 'agents.manage');
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/prospects/paste'));
  const action = read('../../app/admin/prospects/paste/actions.js');
  assert.ok(action.includes("requireAdmin('agents.manage')"));
  assert.ok(action.includes('extractCongoPhones(postText)'), 'the browser preview is never trusted');
  assert.ok(action.includes("action: 'prospects.facebook_paste'"));
  assert.ok(!/details:[^}]*postText/.test(action), 'the post text never reaches the audit log');
  const page = read('../../app/admin/prospects/paste/page.js');
  assert.ok(page.includes("can(session?.role, 'agents.manage')"));
});

test('cleanPostUrl keeps http(s) links only', () => {
  assert.equal(cleanPostUrl('https://www.facebook.com/groups/1/posts/2'), 'https://www.facebook.com/groups/1/posts/2');
  assert.equal(cleanPostUrl('javascript:alert(1)'), null);
  assert.equal(cleanPostUrl('not a url'), null);
  assert.equal(cleanPostUrl(''), null);
});

test('the recent list never throws before the migration', async () => {
  const err = Object.assign(new Error('relation "facebook_prospects" does not exist'), { code: '42P01' });
  const { getPool } = await import('../support/fakePool.js');
  const pool = getPool();
  const original = pool.query;
  pool.query = async () => { throw err; };
  try {
    assert.deepEqual(await listRecentFacebookProspects(), { available: false, pendingTotal: 0, rows: [] });
  } finally {
    pool.query = original;
  }
});
