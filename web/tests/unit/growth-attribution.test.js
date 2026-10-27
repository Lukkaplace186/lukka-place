import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attributionFromLocation, chooseSessionAttribution, cleanAttribution, isTagged, sourceOf,
} from '@/lib/attribution';
import {
  RECORD_PAGE_VIEW_CAMPAIGN_SQL, RECORD_PAGE_VIEW_LEGACY_SQL, RECORD_PAGE_VIEW_SQL, UPSERT_VISITOR_TOUCH_SQL,
  attributionFromBody, eventSource, recordPageView, recordVisitorTouch,
} from '@/lib/trackIngest';
import {
  destinationForRest, parsePartnerCookie, partnerCodeStems, partnerCookieValue, refParamApplies, safeDestination,
  searchWithoutRef, suggestPartnerCode, taggedDestination,
} from '@/lib/partnerRules';
import { listingPublicUrl } from '@/lib/listingShareCopy';
import { printListingUrl } from '@/lib/listingShareRules';
import { mesBiensText } from '@/lib/agentCommands';
import { recordPartnerConversion, FIND_PARTNER_BY_CODE_SQL } from '@/lib/partners';
import { RECORD_ACCOUNT_ACQUISITION_SQL } from '@/lib/accountAcquisition';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Growth attribution (2026-10-27): the campaign of every visit, each visitor's
 * first and last touch, where each account came from, and partner codes for
 * agents, creators and campaigns. web/CLAUDE.md, "Where visitors and accounts
 * come from".
 */

const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function recordingPool({ failCodes = [] } = {}) {
  const queries = [];
  const failures = [...failCodes];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql: squash(sql), values });
      const code = failures.shift();
      if (code) {
        const err = new Error(`simulated ${code}`);
        err.code = code;
        throw err;
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

beforeEach(() => reset());

// ---------------------------------------------------------------------------
// lib/attribution.js
// ---------------------------------------------------------------------------

test('a tagged landing URL is read whole: utm tags, the ad click id and the landing path', () => {
  const attr = attributionFromLocation(
    'https://lukkaplace.com/listings/387?utm_source=TikTok&utm_medium=paid&utm_campaign=lancement_dec&utm_content=video3&ttclid=E.C.P.abc123',
    'https://www.tiktok.com/',
  );
  assert.deepEqual(attr, {
    source: 'tiktok',
    medium: 'paid',
    campaign: 'lancement_dec',
    content: 'video3',
    term: null,
    clickId: 'E.C.P.abc123',
    clickIdType: 'ttclid',
    referrerHost: 'tiktok.com',
    landingPath: '/listings/387',
  });
  assert.equal(isTagged(attr), true);
});

test('another site sending the visitor is a source; our own pages and a typed address are not', () => {
  const fromGoogle = attributionFromLocation('https://lukkaplace.com/', 'https://www.google.com/search?q=appartement');
  assert.equal(fromGoogle.referrerHost, 'google.com');
  assert.equal(isTagged(fromGoogle), false);
  assert.equal(sourceOf(fromGoogle), 'google.com');
  assert.equal(attributionFromLocation('https://lukkaplace.com/listings', 'https://lukkaplace.com/'), null);
  assert.equal(attributionFromLocation('https://lukkaplace.com/listings', ''), null);
});

test('one session, one source: a new tagged link replaces the stored one, internal pages keep it', () => {
  const stored = { source: 'facebook', campaign: 'lancement_dec' };
  assert.equal(chooseSessionAttribution(null, stored), stored);
  assert.equal(chooseSessionAttribution({ referrerHost: 'google.com' }, stored), stored);
  const fresh = { source: 'tiktok', campaign: null };
  assert.equal(chooseSessionAttribution(fresh, stored), fresh);
  const referrerOnly = { referrerHost: 'google.com' };
  assert.equal(chooseSessionAttribution(referrerOnly, null), referrerOnly);
});

test('the beacon claim is bounded field by field; a malformed click id or host is dropped', () => {
  const cleaned = cleanAttribution({
    source: ` ${'x'.repeat(500)} `,
    clickId: 'bad id with spaces',
    clickIdType: 'fbclid',
    referrerHost: 'evil.com/<script>',
    landingPath: '//evil.com/x',
    medium: 42,
  });
  assert.equal(cleaned.source.length, 100);
  assert.equal(cleaned.clickId, null);
  assert.equal(cleaned.clickIdType, null);
  assert.equal(cleaned.referrerHost, null);
  assert.equal(cleaned.landingPath, null);
  assert.equal(cleaned.medium, null);
  assert.equal(cleanAttribution({ junk: true }), null);
  assert.equal(cleanAttribution('tiktok'), null);
});

test('an ad click without utm_source is named after its platform', () => {
  assert.equal(sourceOf({ clickIdType: 'fbclid' }), 'facebook');
  assert.equal(sourceOf({ clickIdType: 'ttclid' }), 'tiktok');
  assert.equal(sourceOf(null), 'direct');
});

test('a page cached before the attribution field still sends its bare utmSource', () => {
  assert.equal(attributionFromBody({ utmSource: 'wa_status' }).source, 'wa_status');
  assert.equal(attributionFromBody({}), null);
  assert.equal(eventSource(null, 'direct'), 'direct');
  assert.equal(eventSource({ source: 'agent' }, 'direct'), 'agent');
});

// ---------------------------------------------------------------------------
// Page views and visitor touches
// ---------------------------------------------------------------------------

test('a page view stores its full campaign, falling back one tier per missing column set', async () => {
  const pool = recordingPool({ failCodes: ['42703', '42703'] });
  const written = await recordPageView(pool, {
    path: '/listings/387', commune: null, device: 'mobile', source: 'tiktok', visitorId: 'abcdefgh1234',
    viewerKind: 'visitor', agentId: null,
    attribution: { medium: 'paid', campaign: 'lancement_dec', content: 'video3', clickIdType: 'ttclid' },
    refCode: 'NADIA01',
  });
  assert.equal(written, true);
  assert.deepEqual(pool.queries.map((q) => q.sql), [
    squash(RECORD_PAGE_VIEW_CAMPAIGN_SQL), squash(RECORD_PAGE_VIEW_SQL), squash(RECORD_PAGE_VIEW_LEGACY_SQL),
  ]);
  assert.deepEqual(pool.queries[0].values.slice(8), ['paid', 'lancement_dec', 'video3', null, 'ttclid', null, 'NADIA01']);
});

test('a failure other than a missing column is not swallowed by the fallback', async () => {
  const pool = recordingPool({ failCodes: ['23514'] });
  await assert.rejects(recordPageView(pool, { path: '/', device: null, source: 'direct', viewerKind: 'visitor' }));
});

test('the first touch is written once and never updated; the last moves only on a touch', () => {
  const sql = squash(UPSERT_VISITOR_TOUCH_SQL);
  const setClause = sql.slice(sql.indexOf('DO UPDATE SET'));
  assert.doesNotMatch(setClause, /first_/, 'nothing first_* may be in the UPDATE');
  assert.match(setClause, /last_source = CASE WHEN \$12::boolean THEN EXCLUDED\.last_source ELSE visitor_touches\.last_source END/);
  assert.match(setClause, /last_seen_at < NOW\(\) - INTERVAL '30 minutes'/);
});

test('touches are recorded for people only, and a missing table records nothing', async () => {
  for (const kind of ['staff', 'bot', 'prefetch']) {
    const pool = recordingPool();
    assert.equal(await recordVisitorTouch(pool, { visitorId: 'abcdefgh1234', viewerKind: kind }), false);
    assert.equal(pool.queries.length, 0, `${kind} writes no touch`);
  }
  const pool = recordingPool();
  await recordVisitorTouch(pool, {
    visitorId: 'abcdefgh1234', viewerKind: 'visitor', attribution: { source: 'tiktok' }, refCode: 'NADIA01',
  });
  const values = pool.queries[0].values;
  assert.equal(values[1], 'tiktok');
  assert.equal(values[10], 'NADIA01');
  assert.equal(values[11], true, 'a campaign tag is a touch');

  const typed = recordingPool();
  await recordVisitorTouch(typed, { visitorId: 'abcdefgh1234', viewerKind: 'visitor', refCode: 'NADIA01' });
  assert.equal(typed.queries[0].values[1], 'direct');
  assert.equal(typed.queries[0].values[11], false, 'a partner cookie alone is not a touch');

  const missing = recordingPool({ failCodes: ['42P01'] });
  assert.equal(await recordVisitorTouch(missing, { visitorId: 'abcdefgh1234', viewerKind: 'visitor' }), false);
  assert.equal(await recordVisitorTouch(recordingPool(), { visitorId: 'no', viewerKind: 'visitor' }), false);
});

test('an account copies the visitor touch at creation, once (ON CONFLICT DO NOTHING)', () => {
  const sql = squash(RECORD_ACCOUNT_ACQUISITION_SQL);
  assert.match(sql, /LEFT JOIN visitor_touches t ON t\.visitor_id = \$4::text/);
  assert.match(sql, /ON CONFLICT \(account_type, account_id\) DO NOTHING/);
});

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

test('the partner cookie: first valid code, the way it arrived', () => {
  assert.deepEqual(parsePartnerCookie('NADIA01.qr'), { code: 'NADIA01', via: 'qr' });
  assert.deepEqual(parsePartnerCookie('nadia01'), { code: 'NADIA01', via: 'link' });
  assert.equal(parsePartnerCookie('not a code'), null);
  assert.equal(partnerCookieValue('NADIA01', 'evil'), 'NADIA01.link');
});

test('?ref= is taken from any page except agent signup, /go, /r, the API and the console', () => {
  for (const path of ['/', '/listings', '/listings/387', '/compte/inscription', '/location/gombe']) {
    assert.equal(refParamApplies(path), true, path);
  }
  for (const path of ['/compte/agent/inscription', '/go/NADIA01', '/r/JEAN01', '/api/track', '/admin/dashboard']) {
    assert.equal(refParamApplies(path), false, path);
  }
  assert.equal(refParamApplies('/rapport/12-abc'), true, '/r is a whole segment, not a prefix of /rapport');
  assert.equal(searchWithoutRef('?utm_source=wa_status&ref=MARIE01'), '?utm_source=wa_status');
  assert.equal(searchWithoutRef('?ref=MARIE01'), '');
});

test('/go lands only on this site', () => {
  assert.equal(destinationForRest(undefined), '/');
  assert.equal(destinationForRest(['387']), '/listings/387');
  assert.equal(destinationForRest(['387', 'x']), '/');
  assert.equal(safeDestination('/listings/387?utm_source=x'), '/listings/387?utm_source=x');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/go/NADIA01', '/api/track', 'listings']) {
    assert.equal(safeDestination(bad), null, bad);
  }
});

test('a partner link tags the visit, unless the link already says where it came from', () => {
  assert.equal(
    taggedDestination('/listings/387', { kind: 'creator', code: 'NADIA01' }),
    '/listings/387?utm_source=influencer&utm_medium=partner&utm_content=nadia01',
  );
  assert.equal(
    taggedDestination('/listings/387?utm_source=wa_status&ref=MARIE01', { kind: 'agent', code: 'MARIE01' }),
    '/listings/387?utm_source=wa_status',
  );
});

test('every agent gets a code: their name first, else LP + their id in letters', () => {
  assert.equal(suggestPartnerCode('Marie Nsumbu', []), 'MARIE01');
  assert.equal(suggestPartnerCode('Marie', ['MARIE01', 'MARIE02']), 'MARIE03');
  assert.deepEqual(partnerCodeStems('243 812', { fallbackId: 437 }), ['LPQV']);
  assert.equal(suggestPartnerCode('', [], { fallbackId: 0 }), 'LPA01');
  assert.match(suggestPartnerCode('Élodie', []), /^ELODIE01$/);
});

test('an agent partner is only found while the agent account is live', () => {
  assert.match(squash(FIND_PARTNER_BY_CODE_SQL), /a\.deleted_at IS NULL AND a\.status = 1/);
});

test('an agent is never credited for an account on their own number', async () => {
  const partner = { id: 3, kind: 'agent', code: 'MARIE01', agentId: 41, agentPhone: '+243 812 345 678' };
  const own = await recordPartnerConversion({ partner, accountType: 'customer', accountId: 9, accountPhone: '243812345678' });
  assert.deepEqual(own, { recorded: false, reason: 'self_referral' });
  assert.equal(calls.length, 0);

  enqueue([{ id: 1 }]);
  const other = await recordPartnerConversion({ partner, accountType: 'customer', accountId: 9, accountPhone: '243899999999', via: 'link' });
  assert.equal(other.recorded, true);
  assert.match(calls[0].sql, /ON CONFLICT \(account_type, account_id, event\) DO NOTHING/);
});

// ---------------------------------------------------------------------------
// Agent codes on shared links
// ---------------------------------------------------------------------------

test('the agent code rides last on a shared listing link, with or without a source', () => {
  assert.equal(listingPublicUrl(387, { source: 'wa_status', ref: 'marie01' }), 'https://lukkaplace.com/listings/387?utm_source=wa_status&ref=MARIE01');
  assert.equal(listingPublicUrl(387, { ref: 'MARIE01' }), 'https://lukkaplace.com/listings/387?ref=MARIE01');
  assert.equal(listingPublicUrl(387, { ref: 'not valid' }), 'https://lukkaplace.com/listings/387');
  assert.equal(printListingUrl(305, 'poster', { ref: 'MARIE01' }), 'https://lukkaplace.com/listings/305?utm_source=print&utm_medium=poster&ref=MARIE01');
  assert.match(mesBiensText([{ id: 310, title: 'Appartement', price: 500, purpose: 'rent' }], 1, { refCode: 'MARIE01' }), /listings\/310\?utm_source=wa_command&ref=MARIE01/);
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test('the migration keeps one code namespace with the reps and closes every new table', () => {
  const sql = readFileSync(new URL('../../../migrations/20261027_growth_attribution.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TRIGGER partners_code_not_rep BEFORE INSERT OR UPDATE OF code ON partners/);
  assert.match(sql, /CREATE TRIGGER sales_reps_code_not_partner BEFORE INSERT OR UPDATE OF referral_code ON sales_reps/);
  assert.match(sql, /code ~ '\^\[A-Z\]\{3,10\}\[0-9\]\{2\}\$'/);
  for (const table of ['visitor_touches', 'partners', 'partner_clicks', 'partner_conversions', 'account_acquisitions']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`), table);
  }
  assert.match(sql, /UNIQUE \(account_type, account_id, event\)/);
  assert.match(sql, /UNIQUE \(account_type, account_id\)/);
});
