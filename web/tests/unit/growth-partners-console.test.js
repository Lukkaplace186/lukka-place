import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  CAMPAIGN_MEDIUMS, CAMPAIGN_SOURCES, DEFAULT_CAMPAIGN, buildCampaignLink, campaignDestination, normaliseTag,
} from '@/lib/campaignLinks';
import { costPerAccount, parsePartnerForm, partnerLinks } from '@/lib/partnerRules';
import { PARTNER_CONVERSIONS_SQL, PARTNER_FUNNEL_SQL, createPartner, listPartnerFunnels } from '@/lib/partnersAdmin';
import { AGENT_REFERRAL_STATS_SQL } from '@/lib/partners';
import { can, sectionPermission } from '@/lib/adminRoles';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Growth plan items 4, 11, 12, 16–19 (2026-10-27): the campaign link builder,
 * the invite page, the code field at signup, the agent's "Mes parrainages"
 * card and the partner console. web/CLAUDE.md, "Where visitors and accounts
 * come from".
 */

const read = (file) => readFileSync(path.join(process.cwd(), file), 'utf8');
const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();

beforeEach(() => reset());

// --- item 4: campaign links ----------------------------------------------------

test('a campaign link is built from the fixed vocabulary, folded tags and the default campaign', () => {
  const built = buildCampaignLink({ destination: '387', source: 'tiktok', medium: 'video', campaign: '', content: 'Vidéo 3 — Gombe!' });
  assert.equal(built.ok, true);
  assert.equal(built.url, `https://lukkaplace.com/listings/387?utm_source=tiktok&utm_medium=video&utm_campaign=${DEFAULT_CAMPAIGN}&utm_content=video_3_gombe`);
  assert.equal(normaliseTag('Lancement Décembre!'), 'lancement_decembre');
  assert.ok(CAMPAIGN_SOURCES.includes('influencer') && CAMPAIGN_MEDIUMS.includes('qr'));
});

test('a campaign link never points off the site, and only takes listed sources and formats', () => {
  assert.equal(campaignDestination(''), '/');
  assert.equal(campaignDestination('https://lukkaplace.com/location/gombe?x=1'), '/location/gombe?x=1');
  assert.equal(campaignDestination('https://evil.com/x'), null);
  assert.equal(campaignDestination('/api/track'), null);
  assert.deepEqual(buildCampaignLink({ destination: 'https://evil.com', source: 'facebook' }), { ok: false, error: 'destination' });
  assert.deepEqual(buildCampaignLink({ destination: '', source: 'Facebook ' }), { ok: false, error: 'source' });
  assert.deepEqual(buildCampaignLink({ destination: '', source: 'facebook', medium: 'banner' }), { ok: false, error: 'medium' });
});

test('a partner code on a campaign link rides as ref, and an old tag on the path is replaced', () => {
  const built = buildCampaignLink({ destination: '/listings?utm_source=old&ref=X', source: 'radio', ref: 'nadia01' });
  assert.equal(built.url, `https://lukkaplace.com/listings?utm_source=radio&utm_campaign=${DEFAULT_CAMPAIGN}&ref=NADIA01`);
});

// --- partner rules ---------------------------------------------------------------

test('cost per account: a per-signup fee is itself; a flat fee is split over every verified account', () => {
  assert.deepEqual(costPerAccount({ amount: 5, currency: 'USD', basis: 'per_signup' }, 0), { amount: 5, currency: 'USD' });
  assert.deepEqual(costPerAccount({ amount: 100, currency: 'USD', basis: 'flat' }, 3), { amount: 33.33, currency: 'USD' });
  assert.equal(costPerAccount({ amount: 100, currency: 'USD', basis: 'flat' }, 0), null, 'never "0 $" or infinity');
  assert.equal(costPerAccount(null, 10), null);
});

test('the partner form is checked field by field', () => {
  const parsed = parsePartnerForm({ kind: 'creator', name: ' Nadia ', code: 'nadia01', fee_amount: '150,5', fee_currency: 'USD', fee_basis: 'flat' });
  assert.deepEqual(parsed.fee, { amount: 150.5, currency: 'USD', basis: 'flat' });
  assert.equal(parsed.code, 'NADIA01');
  assert.equal(parsed.name, 'Nadia');
  assert.throws(() => parsePartnerForm({ kind: 'agent', name: 'X' }), /kind/, 'agents are never created by hand');
  assert.throws(() => parsePartnerForm({ kind: 'creator', name: '' }), /name/);
  assert.throws(() => parsePartnerForm({ kind: 'creator', name: 'X', code: 'N1' }), /code_format/);
  assert.throws(() => parsePartnerForm({ kind: 'creator', name: 'X', fee_amount: 'abc' }), /fee/);
  assert.equal(parsePartnerForm({ name: 'X', status: 'inactive' }, { creating: false }).status, 'inactive');
});

test('a partner hands out a bio link, an invite page, a link per listing and a QR link', () => {
  assert.deepEqual(partnerLinks('NADIA01', { listingId: '387' }), {
    home: 'https://lukkaplace.com/go/NADIA01',
    listing: 'https://lukkaplace.com/go/NADIA01/387',
    invite: 'https://lukkaplace.com/i/NADIA01',
    qr: 'https://lukkaplace.com/go/NADIA01?src=qr',
  });
  assert.equal(partnerLinks('NADIA01', { listingId: 'abc' }).listing, null);
});

// --- items 17–19: partner console data ---------------------------------------------

test('the funnel follows each clicked visitor AFTER their click, people only', () => {
  const sql = squash(PARTNER_FUNNEL_SQL);
  assert.match(sql, /JOIN page_views pv ON pv\.visitor_id = fc\.visitor_id AND pv\.created_at >= fc\.at AND pv\.listing_id IS NOT NULL/);
  assert.match(sql, /JOIN whatsapp_clicks w ON w\.visitor_id = fc\.visitor_id AND w\.created_at >= fc\.at/);
  assert.match(sql, /COALESCE\(pv\.viewer_kind, 'visitor'\) = 'visitor'/);
  assert.match(sql, /COALESCE\(w\.viewer_kind, 'visitor'\) = 'visitor'/);
  assert.match(sql, /cu\.phone_verified_at IS NOT NULL OR ag\.phone_verified_at IS NOT NULL/);
});

test('the partner list reads one page with a search escaped for LIKE, and says so before the migration', async () => {
  enqueue([{ id: 1, kind: 'creator', code: 'NADIA01', name: 'Nadia', status: 'active', clicks: 12, visitors: 9, viewers: 4,
    listing_views: 11, whatsapp_taps: 2, accounts: 3, verified: 2, verified_all: 2, fee_amount: '100', fee_currency: 'USD', fee_basis: 'flat', total: '1' }]);
  const result = await listPartnerFunnels({ kind: 'creator', q: '50%_off', limit: 25, offset: 0 });
  assert.equal(result.available, true);
  assert.deepEqual(calls[0].values.slice(1, 6), ['creator', null, '%50\\%\\_off%', 25, 0]);
  assert.deepEqual(result.rows[0].costPerAccount, { amount: 50, currency: 'USD' });

  const missing = { ...new Error('no table'), code: '42P01' };
  const { getPool } = await import('../support/fakePool.js');
  const pool = getPool();
  const original = pool.query;
  pool.query = async () => { throw Object.assign(new Error('relation "partners" does not exist'), missing); };
  try {
    assert.deepEqual(await listPartnerFunnels({}), { available: false, rows: [], total: 0 });
  } finally {
    pool.query = original;
  }
});

test('a partner created without a code gets one from its name, skipping codes reps and partners hold', async () => {
  enqueue([{ code: 'NADIA01' }]);
  enqueue([{ id: 7, code: 'NADIA02' }]);
  const created = await createPartner({ kind: 'creator', name: 'Nadia', handle: '@nadia', notes: null, code: null, fee: null });
  assert.deepEqual(created, { id: 7, code: 'NADIA02' });
  assert.match(calls[0].sql, /UNION SELECT referral_code FROM sales_reps/);
  assert.deepEqual(calls[1].values.slice(0, 3), ['creator', 'NADIA02', 'Nadia']);
});

test('accounts from one connection are a fact shown for review, never a verdict', () => {
  assert.match(squash(PARTNER_CONVERSIONS_SQL), /COUNT\(\*\) OVER \(PARTITION BY c\.ip_hash\)/);
  const page = read('app/admin/partenaires/[id]/page.js');
  assert.match(page, /SAME_CONNECTION_FLAG = 3/);
  assert.doesNotMatch(page, /DELETE|reject/i);
});

test('the console sections exist, behind partners.view; writes are the owner\'s', () => {
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/partenaires') && ADMIN_NAV_HREFS.includes('/admin/liens'));
  assert.equal(sectionPermission('/admin/partenaires/12'), 'partners.view');
  assert.equal(sectionPermission('/admin/liens'), 'partners.view');
  assert.equal(can('sales', 'partners.view'), false);
  assert.equal(can('analyst', 'partners.view'), true);
  assert.equal(can('moderator', 'partners.manage'), false);
  const actions = read('app/admin/partenaires/actions.js');
  assert.equal(actions.match(/requireAdmin\('partners\.manage'\)/g)?.length, 3);
  assert.match(read('app/admin/partenaires/[id]/qr/route.js'), /can\(session\.role, 'partners\.view'\)/);
});

// --- item 11: invite page ------------------------------------------------------------

test('the invite page remembers the partner from the browser, through the same helper as /go', () => {
  const page = read('app/(site)/i/[code]/page.js');
  assert.match(page, /<RememberInvite code=\{code\} \/>/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /redirect\(`\/r\//, 'a rep code goes to its own page');
  assert.ok(!existsSync(path.join(process.cwd(), 'app/(site)/i/[code]/loading.js')), 'no loading.js: a dead code must be a real 404');
  assert.match(read('app/(site)/i/[code]/actions.js'), /rememberPartnerVisit\(/);
  assert.match(read('app/go/[code]/[[...rest]]/route.js'), /rememberPartnerVisit\(/);
});

// --- item 12: code field at signup ------------------------------------------------------

test('customer signup refuses an unknown partner code before the account exists, and credits a typed one', () => {
  const action = read('app/(site)/compte/inscription/actions.js');
  const refuse = action.indexOf('error=ref');
  const create = action.indexOf('await createCustomer(');
  assert.ok(refuse > 0 && refuse < create, 'the refusal comes before createCustomer');
  assert.match(action, /typedCode: typedCode \|\| null/);
  assert.match(read('app/(site)/compte/inscription/SignupForm.js'), /name="partner_code"/);
});

test('agent signup takes a partner code in the same field, without checking it against the reps', () => {
  const action = read('app/(site)/compte/agent/inscription/actions.js');
  assert.match(action, /if \(typedReferral && !partnerCode\) \{/);
  assert.match(action, /typedCode: partnerCode,/);
  assert.match(read('app/(site)/compte/agent/inscription/page.js'), /partnerCodePrefill\(null\)/);
});

// --- item 16: the agent's card -----------------------------------------------------------

test('Mes parrainages counts customer accounts only, and money only from the agent\'s own credits', () => {
  const sql = squash(AGENT_REFERRAL_STATS_SQL);
  assert.match(sql, /c\.account_type = 'customer'/);
  const card = read('components/AgentReferralCard.js');
  // Amounts come from getAgentCreditSummary (lib/referralCredits.js), never typed in the card.
  assert.match(card, /getAgentCreditSummary\(agentId\)/);
  assert.match(card, /REFERRAL_CREDIT\.amount/);
  assert.match(read('app/compte/agent/page.js'), /<AgentReferralCard agentId=\{agentId\} \/>/);
  assert.match(read('components/AgentPortfolioBanner.js'), /\?ref=\$\{refCode\}/);
});

test('the migration records partner fees and indexes the funnel joins', () => {
  const sql = readFileSync(new URL('../../../migrations/20261027_growth_attribution.sql', import.meta.url), 'utf8');
  assert.match(sql, /fee_basis IN \('flat', 'per_signup'\)/);
  assert.match(sql, /page_views_visitor_created_idx ON page_views \(visitor_id, created_at\)/);
  assert.match(sql, /whatsapp_clicks_visitor_created_idx ON whatsapp_clicks \(visitor_id, created_at\)/);
});
