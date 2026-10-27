import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  ACTIVATION_WINDOW_DAYS, HOLD_DAYS, REFERRAL_CREDIT, approvableAt, evaluateActivation, phoneHash, referralFlags,
  sumByCurrency, voidReasonFor,
} from '@/lib/referralRules';
import { CHANNELS, channelOf, dailySummaryText, paidChannelCosts, weekStart, CHANNEL_LABELS_FR } from '@/lib/growthRules';
import {
  CONSENT_COOKIE, cleanAdEvent, consentAllowsAds, consentRequired, parseAdQueue, SERVER_AD_EVENTS, TIKTOK_EVENT_NAME,
} from '@/lib/adTrackingRules';
import { metaPayload, tiktokPayload } from '@/lib/adServerEvents';
import { nudgeAllowedOn, shouldNudge } from '@/lib/signupNudgeRules';
import { growthSettingsFromStored, parseGrowthForm, DEFAULT_FOUNDER_CUTOFF } from '@/lib/growthSettingsRules';
import { whatsappSignupLink, whatsappSignupText } from '@/lib/whatsappSignup';
import { CREDIT_CANDIDATES_SQL, syncReferralCredits } from '@/lib/referralCredits';
import {
  AUTO_PICK_SQL, PRICE_GUIDES_SQL, VIDEO_LISTINGS_SQL, LUKKA_INDEX_SQL, COLLECTIONS, priceGuideSlug,
} from '@/lib/browseFeatures';
import { announcementText } from '@/lib/referralAnnouncement';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Growth plan items 5–7, 13–17, 20–25, 27–31 (2026-10-27). web/CLAUDE.md,
 * "Referral credits, ad tracking and the launch pages".
 */

const read = (file) => readFileSync(path.join(process.cwd(), file), 'utf8');
const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => reset());

// --- 13: the $1 rule ---------------------------------------------------------------

test('a customer counts once verified AND one real action within 14 days, dated by the later', () => {
  const created = new Date('2026-11-01T10:00:00Z');
  const verdict = evaluateActivation({
    createdAt: created,
    verifiedAt: new Date(created.getTime() + 60_000),
    firstAlertAt: new Date(created.getTime() + 3 * DAY),
  }, new Date(created.getTime() + 4 * DAY));
  assert.equal(verdict.status, 'qualified');
  assert.equal(verdict.activation, 'alert');
  assert.equal(verdict.qualifiedAt.toISOString(), new Date(created.getTime() + 3 * DAY).toISOString());
  assert.equal(REFERRAL_CREDIT.amount, 1);
  assert.equal(REFERRAL_CREDIT.currency, 'USD');
});

test('verified with no action, or an action after the window, does not count', () => {
  const created = new Date('2026-11-01T10:00:00Z');
  const waiting = evaluateActivation({ createdAt: created, verifiedAt: created }, new Date(created.getTime() + 2 * DAY));
  assert.equal(waiting.status, 'waiting');
  const late = evaluateActivation({
    createdAt: created, verifiedAt: created, firstFavoriteAt: new Date(created.getTime() + (ACTIVATION_WINDOW_DAYS + 1) * DAY),
  }, new Date(created.getTime() + 20 * DAY));
  assert.equal(late.status, 'expired');
  const unverified = evaluateActivation({ createdAt: created, firstVisitAt: created }, new Date(created.getTime() + 20 * DAY));
  assert.equal(unverified.status, 'expired');
});

test('the hold is 7 days, and the never-earns reasons are named', () => {
  assert.equal(HOLD_DAYS, 7);
  assert.equal(approvableAt('2026-11-01T00:00:00Z').toISOString(), '2026-11-08T00:00:00.000Z');
  assert.equal(voidReasonFor({ isAgentNumber: true }), 'auto:agent_number');
  assert.equal(voidReasonFor({ alreadyCredited: true }), 'auto:number_already_credited');
  assert.equal(voidReasonFor({}), null);
  assert.equal(phoneHash('+243 812 345 678', 's'), phoneHash('243812345678', 's'), 'digits only');
  assert.notEqual(phoneHash('243812345678', 's'), '243812345678');
});

test('flags are facts: a burst from one connection, a low activation rate once settled', () => {
  assert.deepEqual(referralFlags({ maxSameConnection24h: 3 }), ['burst']);
  assert.deepEqual(referralFlags({ settledAccounts: 10, settledActivated: 2 }), ['low_activation']);
  assert.deepEqual(referralFlags({ settledAccounts: 4, settledActivated: 0 }), [], 'too few to judge');
  assert.deepEqual(sumByCurrency([{ amount: 1, currency: 'USD' }, { amount: 2.5, currency: 'USD' }, { amount: 1000, currency: 'CDF' }]), { USD: 3.5, CDF: 1000 });
});

test('the credit run only reads agent partners\' customer conversions not yet credited', () => {
  const sql = squash(CREDIT_CANDIDATES_SQL);
  assert.match(sql, /JOIN partners p ON p\.id = c\.partner_id AND p\.kind = 'agent'/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM partner_credits pc WHERE pc\.conversion_id = c\.id\)/);
  assert.match(sql, /AS is_agent_number/);
  const ledger = read('lib/referralCredits.js');
  assert.match(ledger, /ON CONFLICT \(conversion_id\) DO NOTHING/);
  assert.match(ledger, /FOR UPDATE/, 'payouts lock the credits they pay');
  assert.doesNotMatch(ledger, /DELETE FROM partner_credits/, 'a credit is never deleted');
});

test('a qualified agent number is written VOID with its reason; an unpaid credit of a deleted account is voided', async () => {
  const created = new Date(Date.now() - 3 * DAY);
  enqueue([{
    conversion_id: 9, partner_id: 3, account_id: 41, phone: '243812345678',
    account_created_at: created, phone_verified_at: created, first_favorite_at: new Date(created.getTime() + DAY),
    first_alert_at: null, is_agent_number: true,
  }]);
  const result = await syncReferralCredits({ now: new Date() });
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO partner_credits'));
  assert.ok(insert, 'a credit row is written');
  assert.equal(insert.values[6], 'void');
  assert.equal(insert.values[10], 'auto:agent_number');
  assert.ok(calls.some((c) => /SET status = 'void', void_reason = 'auto:account_deleted'/.test(c.sql)));
  assert.ok(calls.some((c) => /SET clawback_flagged_at = NOW\(\)/.test(c.sql)), 'a paid one is flagged, never reversed');
  assert.equal(result.available, true);
});

test('only finance and the owner pay; the programme announcement is session text naming the rule', () => {
  const actions = read('app/admin/partenaires/agents/actions.js');
  assert.equal(actions.match(/requireAdmin\('partners\.payout'\)/g)?.length, 4);
  assert.match(actions, /requireAdmin\('partners\.manage'\)/);
  const text = announcementText({ firstName: 'Marie', inviteLink: 'https://lukkaplace.com/i/MARIE01' });
  assert.match(text, /1 \$ pour chaque client/);
  assert.match(text, /14 jours/);
  assert.match(text, /https:\/\/lukkaplace\.com\/i\/MARIE01/);
  assert.match(read('lib/accountAcquisition.js'), /lp_staff[\s\S]*lukka_impersonation/, 'a team browser never credits a partner');
});

// --- 5–7: pixels, server events, consent -----------------------------------------------

test('Europe is asked first; Kinshasa is not; no cookie means nothing is sent', () => {
  assert.equal(consentRequired({ timeZone: 'Europe/Paris' }), true);
  assert.equal(consentRequired({ timeZone: 'Europe/London' }), true);
  assert.equal(consentRequired({ timeZone: 'Atlantic/Canary' }), true);
  assert.equal(consentRequired({ timeZone: 'Africa/Kinshasa' }), false);
  assert.equal(consentAllowsAds('granted'), true);
  assert.equal(consentAllowsAds('na'), true);
  assert.equal(consentAllowsAds('denied'), false);
  assert.equal(consentAllowsAds(undefined), false);
  assert.equal(CONSENT_COOKIE, 'lp_consent');
});

test('the server copy takes known events only, a same-site URL, and four bounded params', () => {
  assert.deepEqual(SERVER_AD_EVENTS, ['ViewContent', 'Search', 'Contact', 'CompleteRegistration', 'Schedule']);
  assert.equal(cleanAdEvent({ name: 'PageView', eventId: 'pv-12345' }), null);
  assert.equal(cleanAdEvent({ name: 'Contact', eventId: 'bad id' }), null);
  const event = cleanAdEvent({
    name: 'ViewContent', eventId: 'vie-abc123', url: 'https://evil.com/x',
    params: { contentIds: [387, 'x', '12'], value: 900, currency: 'USD', extra: 'dropped' },
  });
  assert.equal(event.url, null);
  assert.deepEqual(event.params, { contentIds: ['387', '12'], value: 900, currency: 'USD', searchString: null });
  assert.equal(cleanAdEvent({ name: 'Search', eventId: 'sea-123456', url: 'https://lukkaplace.com/listings?q=x' }).url, 'https://lukkaplace.com/listings');
});

test('personal data leaves hashed, under the same event id on both platforms', () => {
  const user = { ip: '1.2.3.4', userAgent: 'UA', visitorId: 'visitor-0001', phone: '+243 812 345 678', fbp: 'fb.1.1.1', ttclid: 'tt-1' };
  const meta = metaPayload({ name: 'CompleteRegistration', eventId: 'reg-c-5', eventTime: 1, url: null, user, params: {} });
  const data = meta.data[0];
  assert.equal(data.event_id, 'reg-c-5');
  assert.equal(data.action_source, 'website');
  assert.match(data.user_data.ph[0], /^[0-9a-f]{64}$/);
  assert.notEqual(data.user_data.ph[0], '243812345678');
  assert.match(data.user_data.external_id[0], /^[0-9a-f]{64}$/);
  const tiktok = tiktokPayload({ pixelId: 'C123', name: 'Schedule', eventId: 'vis-1', eventTime: 1, url: 'https://lukkaplace.com/listings/1', user, params: { contentIds: ['1'] } });
  assert.equal(tiktok.data[0].event, TIKTOK_EVENT_NAME.Schedule);
  assert.equal(tiktok.data[0].event_id, 'vis-1');
  assert.match(tiktok.data[0].user.phone, /^[0-9a-f]{64}$/);
  assert.equal(tiktok.data[0].user.ttclid, 'tt-1');
});

test('the access tokens stay on the server; the pixels load only after the decision', () => {
  const events = read('lib/adServerEvents.js');
  assert.match(events, /process\.env\.META_CAPI_TOKEN/);
  assert.match(events, /process\.env\.TIKTOK_EVENTS_TOKEN/);
  assert.match(events, /^import 'server-only';/);
  for (const file of ['components/AdTracking.js', 'lib/adEvents.js', 'lib/adPixelLoaders.js', 'lib/adTrackingRules.js']) {
    assert.doesNotMatch(read(file), /CAPI_TOKEN|EVENTS_TOKEN/, `${file} must never see a token`);
  }
  const tracking = read('components/AdTracking.js');
  assert.match(tracking, /if \(state !== 'on'\) return;\s+loadMetaPixel/);
  assert.match(read('app/(site)/layout.js'), /<AdTracking metaPixelId=\{growth\.metaPixelId\} tiktokPixelId=\{growth\.tiktokPixelId\} \/>/);
  assert.deepEqual(parseAdQueue(encodeURIComponent(JSON.stringify([{ n: 'Schedule', id: 'vis-123' }, { n: 'Evil', id: 'x-1234' }]))), [{ n: 'Schedule', id: 'vis-123', p: {} }]);
});

test('the pixel ids come from settings or the environment, and a bad id refuses the save', () => {
  assert.deepEqual(growthSettingsFromStored(null, { META_PIXEL_ID: '123456789012345' }), {
    metaPixelId: '123456789012345', tiktokPixelId: null, founderCutoff: DEFAULT_FOUNDER_CUTOFF,
  });
  assert.equal(growthSettingsFromStored({ metaPixelId: 'abc' }, {}).metaPixelId, null);
  assert.deepEqual(parseGrowthForm({ metaPixelId: '12' }), { ok: false, error: 'meta' });
  assert.deepEqual(parseGrowthForm({ tiktokPixelId: 'c9abcdef12345' }).value.tiktokPixelId, 'C9ABCDEF12345');
  assert.equal(DEFAULT_FOUNDER_CUTOFF, '2026-12-21');
  assert.ok(existsSync(path.join(process.cwd(), 'app/(site)/confidentialite/page.js')));
});

// --- 21–22: channels and the dashboard --------------------------------------------------

test('a channel is the partner first, then the paid click, then the source', () => {
  assert.equal(channelOf({ hasAcquisition: false }), 'inconnu');
  assert.equal(channelOf({ partnerKind: 'agent', source: 'facebook' }), 'agents');
  assert.equal(channelOf({ partnerKind: 'creator' }), 'createurs');
  assert.equal(channelOf({ clickIdType: 'fbclid', source: 'facebook' }), 'meta_ads');
  assert.equal(channelOf({ source: 'tiktok', medium: 'paid' }), 'tiktok_ads');
  assert.equal(channelOf({ source: 'tiktok', medium: 'video' }), 'reseaux');
  assert.equal(channelOf({ source: 'google.com' }), 'recherche');
  assert.equal(channelOf({ channel: 'whatsapp' }), 'whatsapp_inscription');
  assert.equal(channelOf({ source: 'direct' }), 'direct');
  assert.equal(channelOf({ source: 'radio' }), 'autre');
  assert.ok(CHANNELS.every((channel) => CHANNEL_LABELS_FR[channel]));
});

test('cost per account is spend over accounts per currency, never "0 $"', () => {
  const costs = paidChannelCosts([{ channel: 'meta_ads', amount: 100, currency: 'USD' }, { channel: 'meta_ads', amount: 50, currency: 'USD' }], { meta_ads: 30, tiktok_ads: 0 });
  assert.deepEqual(costs.meta_ads.perAccount, { USD: 5 });
  assert.deepEqual(costs.tiktok_ads.perAccount, {});
  assert.deepEqual(paidChannelCosts([{ channel: 'tiktok_ads', amount: 80, currency: 'USD' }], {}).tiktok_ads.perAccount, { USD: null });
  assert.equal(weekStart('2026-10-27'), '2026-10-26');
  assert.equal(weekStart('nope'), null);
});

test('the owners\' summary names the channels, the best agent and creator', () => {
  const text = dailySummaryText({
    day: 'mardi 27 octobre', customers: 14, agents: 2, visitors: 812,
    byChannel: { tiktok_ads: 5, agents: 4, direct: 3, meta_ads: 0 },
    topAgent: { name: 'Marie', n: 3 }, topCreator: { name: 'Nadia', n: 4 },
  }, CHANNEL_LABELS_FR);
  assert.match(text, /14 compte\(s\) client : Pub TikTok 5, Agents 4, Direct 3\./);
  assert.doesNotMatch(text, /Pub Meta/);
  assert.match(text, /Meilleur agent : Marie \(3\)/);
  assert.match(text, /Meilleur créateur : Nadia \(4\)/);
});

// --- 23–25 -------------------------------------------------------------------------------

test('the WhatsApp signup message starts with the wording the engine matches, never "parrainage"', () => {
  assert.equal(whatsappSignupText(), 'Inscription Lukka Place');
  assert.equal(whatsappSignupText('nadia01'), 'Inscription Lukka Place — Code : NADIA01');
  assert.doesNotMatch(whatsappSignupText('NADIA01'), /parrainage/i);
  assert.equal(whatsappSignupLink(null, ''), null);
  assert.match(whatsappSignupLink('NADIA01', '+243 976 321 848'), /^https:\/\/wa\.me\/243976321848\?text=Inscription/);
  const activate = read('lib/customers.js');
  assert.match(activate, /activation_token_hash = NULL/);
  assert.match(activate, /activation_expires_at > NOW\(\)/);
  assert.match(read('middleware.js'), /'\/compte\/activer',/);
});

test('the signup prompt: thresholds, once per session, quiet where the bottom edge is taken', () => {
  assert.equal(shouldNudge({ reason: 'favorites', favorites: 1 }), false);
  assert.equal(shouldNudge({ reason: 'favorites', favorites: 2 }), true);
  assert.equal(shouldNudge({ reason: 'listing_viewed', viewed: 3 }), true);
  assert.equal(shouldNudge({ reason: 'no_results' }), true);
  assert.equal(nudgeAllowedOn('/listings/387'), false);
  assert.equal(nudgeAllowedOn('/listings', '?view=map'), false);
  assert.equal(nudgeAllowedOn('/compte/inscription'), false);
  assert.equal(nudgeAllowedOn('/listings', '?commune=Gombe'), true);
  assert.match(read('components/SignupNudge.js'), /lukka_logged_in\|lukka_agent_logged_in/);
});

test('the founder number is counted, never stored', () => {
  const founder = read('lib/founder.js');
  assert.match(founder, /COUNT\(\*\) FROM customers c2/);
  assert.match(founder, /AT TIME ZONE 'Africa\/Kinshasa'/);
});

// --- 27–31: public data only, and nothing thin ------------------------------------------

test('every browse feature reads public listings only', () => {
  for (const [name, sql] of Object.entries({ AUTO_PICK_SQL, PRICE_GUIDES_SQL, VIDEO_LISTINGS_SQL })) {
    assert.match(squash(sql), /p\.status = 1 AND p\.approve_status = 1/, name);
    assert.match(squash(sql), /test_agent/, `${name} leaves test agencies out`);
  }
  assert.match(squash(PRICE_GUIDES_SQL), /HAVING COUNT\(\*\) >= \$1/);
  assert.match(squash(PRICE_GUIDES_SQL), /NOT IN \('jour', 'semaine'\)/, 'short stays never enter a monthly median');
  assert.match(squash(PRICE_GUIDES_SQL), /p\.price_period = 'an' THEN p\.price \/ 12\.0/);
  assert.match(squash(LUKKA_INDEX_SQL), /category_id = -1 AND beds_bucket = 'all'/);
  assert.equal(priceGuideSlug({ beds: 2, commune: 'Gombe' }), '2-chambres-gombe');
  assert.equal(priceGuideSlug({ beds: 1, commune: 'Gombe' }), '1-chambre-gombe');
  assert.deepEqual(COLLECTIONS.map((c) => c.slug), ['villas', 'moins-de-300', 'avec-piscine', 'courte-duree', 'nouveaux']);
});

test('a page with too little behind it is a real 404 (no loading.js above it)', () => {
  for (const dir of ['combien-coute/[slug]', 'collections/[slug]', 'videos', 'combien-coute', 'collections']) {
    assert.ok(!existsSync(path.join(process.cwd(), `app/(site)/${dir}/loading.js`)), dir);
  }
  assert.match(read('app/(site)/combien-coute/[slug]/page.js'), /if \(!guide\) notFound\(\);/);
  assert.match(read('app/(site)/collections/[slug]/page.js'), /if \(total < MIN_COLLECTION\) notFound\(\);/);
  assert.match(read('app/(site)/videos/page.js'), /if \(!listings\.length\) notFound\(\);/);
});

test('the launch migration closes every new table and keeps one live credit per number', () => {
  const sql = readFileSync(new URL('../../../migrations/20261028_referral_credits_and_growth.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS partner_credits_phone_live_idx ON partner_credits \(phone_hash\) WHERE status <> 'void'/);
  assert.match(sql, /conversion_id\s+bigint NOT NULL UNIQUE/);
  for (const table of ['partner_payouts', 'partner_credits', 'partner_program_announcements', 'partner_social_stats', 'ad_spend_weekly', 'featured_listing_days']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`), table);
  }
  assert.match(sql, /ALTER TABLE customers ADD COLUMN IF NOT EXISTS activation_token_hash text/);
});
