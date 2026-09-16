import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUOTA_COUNTED_SQL, UPGRADE_PATH, quotaRefusal, quotaState } from '@/lib/listingQuotaRules';
import { LISTING_QUOTA_SQL, getListingQuota } from '@/lib/listingQuota';
import { HERO_ALT_MAX, allowedHeroUrl, heroFromStored, validateHeroText } from '@/lib/cmsHeroRules';
import { listAgenciesForAdmin } from '@/lib/adminAgencies';
import { getAgentContactsByIds } from '@/lib/agents';
import { REFERRED_AGENT_FILTERS } from '@/lib/salesLaunch';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

test.beforeEach(() => reset());

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Listing limits
// ---------------------------------------------------------------------------

test('no plan or a plan with no listing allowance never blocks', () => {
  assert.equal(quotaState({ limit: null, used: 40 }).blocked, false);
  assert.equal(quotaState({ limit: 0, used: 40 }).capped, false, 'a 0-listing package (photography) is not a listing plan');
});

test('the limit blocks exactly when the listings would exceed it', () => {
  assert.deepEqual(
    [quotaState({ limit: 2, used: 1 }).blocked, quotaState({ limit: 2, used: 2 }).blocked, quotaState({ limit: 2, used: 3 }).blocked],
    [false, true, true],
  );
  assert.equal(quotaState({ limit: 2, used: 2 }).atLimit, true);
  assert.equal(quotaState({ limit: 15, used: 12 }, 4).blocked, true, 'a 4-unit building does not fit in 3 slots');
  assert.equal(quotaState({ limit: 15, used: 12 }, 3).blocked, false);
  assert.equal(quotaState({ limit: 5, used: 9 }).remaining, 0, 'never a negative remainder');
});

test('a refusal carries the message and what the upgrade prompt needs', () => {
  const t = (key, vars) => `${key}:${JSON.stringify(vars || {})}`;
  const refusal = quotaRefusal(t, quotaState({ limit: 5, used: 5, planTitle: 'Bronze' }));
  assert.equal(refusal.ok, false);
  assert.match(refusal.error, /^agent\.quota\.reached:.*"limit":5.*"plan":"Bronze"/);
  assert.deepEqual(refusal.quota, { limit: 5, used: 5, plan: 'Bronze', upgradeHref: UPGRADE_PATH });
  assert.equal(UPGRADE_PATH, '/compte/agent/abonnement');
});

test('pending listings take a slot; archived, rejected and closed ones do not', () => {
  assert.equal(QUOTA_COUNTED_SQL, "p.status = 1 AND p.approve_status IN (0, 1) AND COALESCE(p.listing_status, 'active') <> 'closed'");
  const sql = normalizeSql(LISTING_QUOTA_SQL);
  assert.ok(sql.includes('p.agent_id IN (SELECT o.id FROM agents o WHERE o.vendor_id = a.vendor_id)'), 'an agency counts all its agents');
  assert.ok(sql.includes('m.status = 1 AND m.expire_date > NOW() AND pk.number_of_property > 0'));
  assert.ok(sql.includes('ORDER BY pk.number_of_property DESC'), 'the most generous active listing plan applies');
});

test('the engine enforces the same counting rule on WhatsApp', () => {
  const engine = read('../../../services/listingQuota.js');
  assert.ok(engine.includes(`const QUOTA_COUNTED_SQL = "${QUOTA_COUNTED_SQL}"`), 'web and engine must count the same listings');
  assert.ok(engine.includes('pk.number_of_property > 0'));
});

test('getListingQuota reads one agent and applies the rules', async () => {
  enqueue([{ id: 7, vendor_id: 3, listing_limit: 2, plan_title: 'Free', used: 2 }]);
  const quota = await getListingQuota(7);
  assert.deepEqual(calls[0].values, [7]);
  assert.equal(quota.blocked, true);
  assert.equal(quota.planTitle, 'Free');
  reset();
  enqueue([]);
  assert.equal(await getListingQuota(999), null);
});

test('every way an agent can add a listing checks the limit, after the offline replay guard', () => {
  const actions = read('../../app/compte/agent/actions.js');
  const create = actions.slice(actions.indexOf('export async function createListingAction'));
  const replay = create.indexOf("formData.get('offline_replay') === '1'");
  const check = create.indexOf('getListingQuota(agentId, 1)');
  const insert = create.indexOf('await createListing(');
  assert.ok(replay > 0 && check > replay && insert > check, 'replay guard → quota → create');
  for (const name of ['duplicateListingAction', 'setListingArchivedAction', 'bulkSetArchivedAction']) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    const end = body.indexOf('\nexport async function', 10);
    assert.ok(body.slice(0, end).includes('getListingQuota('), `${name} must check the limit`);
  }
  const dialog = read('../../components/CreateListingDialog.js');
  assert.ok(dialog.includes('announceListingQuota(result.quota)'), 'the create dialog shows the upgrade prompt on refusal');
  assert.ok(read('../../app/compte/agent/layout.js').includes('<ListingLimitDialog />'));
});

// ---------------------------------------------------------------------------
// CMS hero
// ---------------------------------------------------------------------------

test('a hero URL must be an https image next/image can load', () => {
  const ok = 'https://havyrzfdksabghgbrxfy.supabase.co/storage/v1/object/public/Property_images/cms/hero/abc.jpg';
  assert.equal(allowedHeroUrl(ok), ok);
  assert.ok(allowedHeroUrl('https://lukkaplace.com/assets/img/hero.jpg'));
  assert.equal(allowedHeroUrl(ok.replace('https', 'http')), null);
  assert.equal(allowedHeroUrl('https://images.unsplash.com/photo.jpg'), null);
  assert.equal(allowedHeroUrl('https://havyrzfdksabghgbrxfy.supabase.co/storage/v1/object/sign/x.jpg'), null, 'private objects are not public');
  assert.equal(allowedHeroUrl('https://user:pass@lukkaplace.com/assets/img/x.jpg'), null);
  assert.equal(allowedHeroUrl('javascript:alert(1)'), null);
});

test('hero text is trimmed, optional and bounded; a bad stored value falls back to the built-in photo', () => {
  assert.deepEqual(validateHeroText({ alt: '  Gombe  au soir ', credit: '' }).values, { alt: 'Gombe au soir', credit: null });
  assert.equal(validateHeroText({ alt: 'x'.repeat(HERO_ALT_MAX + 1) }).errorKey, 'admin.cms.hero.altTooLong');
  assert.equal(heroFromStored({ imageUrl: 'https://evil.example/x.jpg' }), null);
  assert.equal(heroFromStored(null), null);
  assert.deepEqual(heroFromStored({ imageUrl: 'https://lukkaplace.com/assets/img/h.jpg', alt: 'A', credit: 42 }), {
    imageUrl: 'https://lukkaplace.com/assets/img/h.jpg', alt: 'A', credit: null,
  });
});

test('the homepage reads the hero on each request and never breaks without it', () => {
  const settings = read('../../lib/cmsSettings.js');
  assert.ok(/export async function getHeroSettings\(\) \{\s+try \{/.test(settings), 'getHeroSettings swallows a missing table');
  assert.ok(read('../../app/(site)/page.js').includes('image={heroImage}'));
  assert.ok(read('../../components/Hero.js').includes('image?.imageUrl ?'), 'the built-in photo stays the fallback');
});

// ---------------------------------------------------------------------------
// Agencies, viewings and leads
// ---------------------------------------------------------------------------

test('an agency row carries its principal contact and is findable by that person’s name', async () => {
  await listAgenciesForAdmin({ q: 'Kabeya' });
  const page = calls.find((c) => /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
  assert.ok(page.sql.includes('pc.name AS contact_name'));
  assert.ok(page.sql.includes('WHERE ca.vendor_id = v.id ORDER BY ca.id LIMIT 1'), 'the first agent of the agency');
  assert.ok(!/ca\.username/.test(page.sql), 'never the phone digits in username as a name');
  assert.ok(page.sql.includes("CONCAT_WS(' ', ain.first_name, ain.last_name) ILIKE"));
});

test('an agent contact says whether WhatsApp alerts can reach them, with digits-only numbers', async () => {
  enqueue([
    { id: 1, phone: '+243 81 000 0001', status: 1, phone_verified_at: '2026-09-01', direct_routing_enabled: true, vendor_id: 4, display_name: 'Grace', agency_name: 'Immo Kin' },
    { id: 2, phone: '243810000002', status: 1, phone_verified_at: null, direct_routing_enabled: true, vendor_id: null, display_name: 'Agent #2', agency_name: 'Agence #0' },
    { id: 3, phone: '243810000003', status: 1, phone_verified_at: '2026-09-01', direct_routing_enabled: false, vendor_id: 5, display_name: 'Jo', agency_name: 'X' },
  ]);
  const contacts = await getAgentContactsByIds([1, 2, 3, 'x', 1]);
  assert.deepEqual(calls[0].values, [[1, 2, 3]]);
  assert.equal(contacts.get(1).phone, '243810000001');
  assert.equal(contacts.get(1).routable, true);
  assert.equal(contacts.get(2).routable, false);
  assert.equal(contacts.get(2).agencyName, null, 'no vendor → no agency shown');
  assert.equal(contacts.get(3).routable, false, 'routing switched off by an admin');
});

test('a viewing or lead with no agent shows the listing’s agent, marked, with one-click assignment', () => {
  const viewings = read('../../app/admin/viewings/page.js');
  assert.ok(viewings.includes('const listingAgentId = agentId ? null : listingAgentOf(row);'));
  assert.ok(viewings.includes("t('admin.viewings.listingAgentNotAlerted')"));
  assert.ok(read('../../app/admin/viewings/ViewingRowActions.js').includes('reassignViewingAction(viewingRequestId, listingAgent.id)'),
    'alerting the listing agent goes through the engine reassign path, which notifies them');
  const leads = read('../../app/admin/leads/page.js');
  assert.ok(leads.includes("t('admin.leads.assignListingAgent')"));
  assert.ok(leads.includes('<WhatsAppLink'));
});

test('the rep page can list the agents who already have a listing', () => {
  assert.ok(REFERRED_AGENT_FILTERS.includes('with_listing'));
});
