import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_ROUTING_TYPES,
  LISTING_EVENT_TYPES,
  RECORD_LISTING_EVENT_LEGACY_SQL,
  RECORD_LISTING_EVENT_SQL,
  RECORD_PAGE_VIEW_LEGACY_SQL,
  RECORD_PAGE_VIEW_SQL,
  cleanVisitorId,
  listingIdFromPath,
  VIEWER_KINDS,
  normaliseSearch,
  recordListingEvent,
  recordPageView,
  recordSearch,
  signedInAgentIdFrom,
  viewerKindFor,
  visitorIdFrom,
} from '@/lib/trackIngest';
import { readFileSync } from 'node:fs';
import { RECORD_LEAD_CLICK_LEGACY_SQL, recordLeadClick } from '@/lib/leadClicks';
import { deviceFromUserAgent } from '@/lib/requestContext';
import { createAgentSessionToken, AGENT_SESSION_COOKIE } from '@/lib/agentAuth';
import { galleryCompleteThreshold, initialGalleryState, noteGalleryStep } from '@/lib/galleryEngagement';
import { AUTOMATED_UA_RE, listingIdFromPath as clientListingIdFromPath } from '@/lib/analyticsClient';

const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();

/** A pool that records every query and can fail the first N with a given code. */
function recordingPool({ failWith = null, failTimes = 1, rowCount = 1 } = {}) {
  const calls = [];
  let failures = 0;
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: squash(sql), values });
      if (failWith && failures < failTimes) {
        failures += 1;
        const err = new Error(`simulated ${failWith}`);
        err.code = failWith;
        throw err;
      }
      return { rows: [], rowCount };
    },
  };
}

/** Just enough of NextRequest for the cookie readers. */
function fakeRequest(cookies = {}, headers = new Headers()) {
  return { headers, cookies: { get: (name) => (name in cookies ? { value: cookies[name] } : undefined) } };
}

// --- everybody becomes a row, labelled ------------------------------------------

test('every viewer is recorded and labelled: team, bot, prefetch, agent, visitor', () => {
  assert.deepEqual(VIEWER_KINDS, ['visitor', 'owner', 'agent', 'staff', 'bot', 'prefetch']);
  assert.equal(viewerKindFor(fakeRequest(), 'mobile'), 'visitor');
  assert.equal(viewerKindFor(fakeRequest(), 'bot'), 'bot');
  assert.equal(viewerKindFor(fakeRequest(), 'desktop', { automated: true }), 'bot');
  assert.equal(viewerKindFor(fakeRequest({}, new Headers({ 'sec-purpose': 'prefetch;prerender' })), 'mobile'), 'prefetch');
  assert.equal(viewerKindFor(fakeRequest({}, new Headers({ purpose: 'prefetch' })), 'desktop'), 'prefetch');
  assert.equal(viewerKindFor(fakeRequest({}, new Headers({ 'next-router-prefetch': '1' })), 'desktop'), 'prefetch');
  assert.equal(viewerKindFor(fakeRequest(), 'mobile', { agentId: 7 }), 'agent');
  // The team outranks everything else: an admin who is also an agent is staff.
  assert.equal(viewerKindFor(fakeRequest({ lp_staff: '1' }), 'bot', { agentId: 7 }), 'staff');
  assert.equal(viewerKindFor(fakeRequest({ lukka_impersonation: 'imp1.x' }), 'mobile'), 'staff');
  assert.equal(viewerKindFor(fakeRequest({ lp_staff: 'yes' }), 'mobile'), 'visitor', 'only the exact marker');
});

test('middleware marks an authenticated admin browser as staff, path /', () => {
  const source = readFileSync(new URL('../../middleware.js', import.meta.url), 'utf8');
  assert.match(source, /response\.cookies\.set\('lp_staff', '1', \{\s*path: '\/'/);
  assert.match(source, /isValidSessionToken\(token\)\) \{\s*return withStaffMarker\(/);
});

test('the migration allows exactly the viewer kinds the writer uses', () => {
  const sql = readFileSync(new URL('../../../migrations/20260929_engagement_tracking.sql', import.meta.url), 'utf8');
  for (const table of ['page_views', 'whatsapp_clicks', 'listing_events', 'search_events']) {
    assert.ok(sql.includes(`'${table}'`), table);
  }
  const inner = /viewer_kind IN \(([^)]*)\)/.exec(sql)[1].replace(/''/g, "'");
  assert.deepEqual(inner.match(/'([a-z]+)'/g).map((v) => v.slice(1, -1)), VIEWER_KINDS);
});

test('the WhatsApp link-preview fetcher is a bot; a person in WhatsApp\'s in-app browser is not', () => {
  assert.equal(deviceFromUserAgent('WhatsApp/2.23.20.0 A'), 'bot');
  assert.equal(deviceFromUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'), 'bot');
  // Android WebView inside WhatsApp — a real person on a phone.
  assert.equal(
    deviceFromUserAgent(
      'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    ),
    'mobile',
  );
  // The client flags the same strings as automated (stored as 'bot', never dropped).
  assert.ok(AUTOMATED_UA_RE.test('WhatsApp/2.23.20.0 A'));
  assert.ok(AUTOMATED_UA_RE.test('Mozilla/5.0 HeadlessChrome/120.0'));
  assert.ok(!AUTOMATED_UA_RE.test('Mozilla/5.0 (Linux; Android 13; wv) Chrome/122.0.0.0 Mobile Safari/537.36'));
});

test('the signed-in agent is read from a genuine agent session cookie only', () => {
  const token = createAgentSessionToken({ agentId: 42, tokenVersion: 0 });
  assert.equal(signedInAgentIdFrom(fakeRequest({ [AGENT_SESSION_COOKIE]: token })), 42);
  // Someone else's id with this token's signature: refused.
  const forged = token.replace(/^42\./, '43.');
  assert.equal(signedInAgentIdFrom(fakeRequest({ [AGENT_SESSION_COOKIE]: forged })), null);
  assert.equal(signedInAgentIdFrom(fakeRequest({})), null);
});

test('the visitor id prefers the cookie, and only a well-formed id is ever stored', () => {
  const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  assert.equal(visitorIdFrom(fakeRequest({ lp_vid: id }), 'body-supplied-id'), id);
  assert.equal(visitorIdFrom(fakeRequest({}), id), id);
  assert.equal(cleanVisitorId('short'), null);
  assert.equal(cleanVisitorId("x'); DROP TABLE page_views;--"), null);
  assert.equal(cleanVisitorId('a'.repeat(65)), null);
});

// --- page views ---------------------------------------------------------------

test('a listing page view stores its listing id, visitor and viewer kind, the owner included', async () => {
  const pool = recordingPool();
  const written = await recordPageView(pool, {
    path: '/listings/310', commune: 'Kintambo', device: 'mobile', source: 'direct', visitorId: 'visitor-0001', viewerKind: 'agent', agentId: 7,
  });
  assert.equal(written, true);
  assert.equal(pool.calls[0].sql, squash(RECORD_PAGE_VIEW_SQL));
  assert.ok(!/NOT EXISTS/.test(pool.calls[0].sql), 'nobody is filtered out');
  // A signed-in agent on their OWN listing is stored as `owner`, decided in SQL.
  assert.match(pool.calls[0].sql, /CASE WHEN \$7::text = 'agent' AND EXISTS \(SELECT 1 FROM properties WHERE id = \$5::bigint AND agent_id = \$8::bigint\) THEN 'owner' ELSE \$7::text END/);
  assert.deepEqual(pool.calls[0].values, ['/listings/310', 'Kintambo', 'mobile', 'direct', 310, 'visitor-0001', 'agent', 7]);
});

test('an unknown viewer kind is stored as a visitor, never as free text', async () => {
  const pool = recordingPool();
  await recordPageView(pool, { path: '/', device: 'mobile', source: 'direct', viewerKind: 'landlord' });
  assert.equal(pool.calls[0].values[6], 'visitor');
});

test('a non-listing path is still a view, with no listing id', async () => {
  const pool = recordingPool();
  await recordPageView(pool, { path: '/agents/12', device: 'desktop', source: 'direct' });
  assert.equal(pool.calls[0].values[4], null);
  assert.equal(listingIdFromPath('/listings/310/'), null);
  assert.equal(listingIdFromPath('/listings/2-chambres-limete'), null);
  assert.equal(listingIdFromPath(`/listings/${'9'.repeat(19)}`), null);
});

test('before the migration a page view is retried without the new columns — never lost', async () => {
  const pool = recordingPool({ failWith: '42703' });
  const written = await recordPageView(pool, {
    path: '/listings/310', device: 'mobile', source: 'direct', visitorId: 'visitor-0001', viewerKind: 'bot',
  });
  assert.equal(written, true);
  assert.equal(pool.calls.length, 2);
  assert.equal(pool.calls[1].sql, squash(RECORD_PAGE_VIEW_LEGACY_SQL));
  assert.ok(!/visitor_id|listing_id|viewer_kind/.test(pool.calls[1].sql), 'legacy insert names no new column');
  assert.deepEqual(pool.calls[1].values, ['/listings/310', null, 'mobile', 'direct']);
});

test('any other database error is not swallowed', async () => {
  const pool = recordingPool({ failWith: '23505' });
  await assert.rejects(() => recordPageView(pool, { path: '/listings/1', device: 'mobile', source: 'direct' }), /23505/);
  assert.equal(pool.calls.length, 1);
});

// --- listing events -------------------------------------------------------------

test('the new funnel steps are listing events, none of them a WhatsApp click', () => {
  for (const event of ['call_click', 'gallery_open', 'gallery_complete', 'share_click', 'listing_saved', 'listing_unsaved']) {
    assert.ok(LISTING_EVENT_TYPES.includes(event), event);
  }
  assert.ok(!LISTING_EVENT_TYPES.includes('whatsapp_click'));
  assert.deepEqual(CALL_ROUTING_TYPES, ['DIRECT', 'CENTRAL']);
});

test('a call keeps its routing; no other event can carry one', async () => {
  const pool = recordingPool();
  await recordListingEvent(pool, {
    event: 'call_click', listingId: 310, commune: 'Kintambo', price: 1300, device: 'mobile', source: 'direct',
    visitorId: 'visitor-0001', routingType: 'DIRECT', viewerKind: 'visitor',
  });
  await recordListingEvent(pool, {
    event: 'gallery_open', listingId: 310, device: 'mobile', source: 'direct', routingType: 'DIRECT',
  });
  await recordListingEvent(pool, {
    event: 'call_click', listingId: 310, device: 'mobile', source: 'direct', routingType: 'SOMEWHERE',
  });
  assert.equal(pool.calls[0].sql, squash(RECORD_LISTING_EVENT_SQL));
  assert.deepEqual(pool.calls[0].values, ['call_click', 310, 'Kintambo', 1300, 'mobile', 'direct', 'visitor-0001', 'DIRECT', 'visitor', null]);
  assert.equal(pool.calls[1].values[7], null, 'a gallery event has no routing');
  assert.equal(pool.calls[2].values[7], null, 'an unknown routing is dropped, not stored');
});

test('listing events label the owner in SQL, retry without new columns, and unknown events are refused', async () => {
  assert.match(squash(RECORD_LISTING_EVENT_SQL), /EXISTS \(SELECT 1 FROM properties WHERE id = \$2::bigint AND agent_id = \$10::bigint\) THEN 'owner'/);
  assert.ok(!/NOT EXISTS/.test(RECORD_LISTING_EVENT_SQL));
  const pool = recordingPool({ failWith: '42703' });
  await recordListingEvent(pool, { event: 'share_click', listingId: 5, device: 'desktop', source: 'direct', viewerKind: 'agent', agentId: 3 });
  assert.equal(pool.calls[1].sql, squash(RECORD_LISTING_EVENT_LEGACY_SQL));
  assert.deepEqual(pool.calls[1].values, ['share_click', 5, null, undefined, 'desktop', 'direct']);
  await assert.rejects(() => recordListingEvent(recordingPool(), { event: 'page_view', listingId: 1 }), /unknown event/);
});

test('a WhatsApp tap carries the visitor and viewer kind (owner included), and retries without them before the migration', async () => {
  const pool = recordingPool({ failWith: '42703' });
  await recordLeadClick(pool, {
    listingId: 293, commune: 'Limete', device: 'mobile', source: 'direct', price: 1100, routingType: 'DIRECT_WA',
    visitorId: 'visitor-0001', viewerKind: 'agent', agentId: 9,
  });
  assert.match(pool.calls[0].sql, /visitor_id, viewer_kind/);
  assert.match(pool.calls[0].sql, /agent_id = \$9::bigint\) THEN 'owner'/);
  assert.ok(!/NOT EXISTS/.test(pool.calls[0].sql));
  assert.deepEqual(pool.calls[0].values, [293, 'Limete', 'mobile', 'direct', 1100, 'DIRECT_WA', 'visitor-0001', 'agent', 9]);
  assert.equal(pool.calls[1].sql, squash(RECORD_LEAD_CLICK_LEGACY_SQL));
  assert.ok(!/visitor_id|viewer_kind/.test(pool.calls[1].sql));
  assert.deepEqual(pool.calls[1].values, [293, 'Limete', 'mobile', 'direct', 1100, 'DIRECT_WA']);
});

// --- searches -------------------------------------------------------------------

test('a search body is bounded to the columns search_events holds', () => {
  const search = normaliseSearch({
    transactionType: 'location',
    communes: ['Limete', 'Limete', 'Gombe', 'Ngaliema', 'Lemba', 'Kintambo', 'Bandalungwa'],
    bedsMin: '2',
    priceMax: '500',
    priceMin: 'abc',
    amenities: ['generator', 'x'.repeat(80)],
    q: '  2 chambres  ',
    resultCount: '0',
  });
  assert.equal(search.purpose, 'rent');
  assert.deepEqual(search.communes, ['Limete', 'Gombe', 'Ngaliema', 'Lemba', 'Kintambo']);
  assert.equal(search.bedsMin, 2);
  assert.equal(search.priceMax, 500);
  assert.equal(search.priceMin, null);
  assert.equal(search.amenities[1].length, 40);
  assert.equal(search.q, '2 chambres');
  assert.equal(search.resultCount, 0, 'zero is a real answer: unmet demand');
});

test('a search with no result count is not stored, and a missing table skips quietly', async () => {
  const pool = recordingPool();
  assert.equal(await recordSearch(pool, normaliseSearch({}), { device: 'mobile', source: 'direct' }), false);
  assert.equal(pool.calls.length, 0);

  const missing = recordingPool({ failWith: '42P01' });
  assert.equal(await recordSearch(missing, normaliseSearch({ resultCount: 3 }), { device: 'mobile', source: 'direct' }), false);

  const ok = recordingPool();
  assert.equal(await recordSearch(ok, normaliseSearch({ resultCount: 3, communes: 'Gombe' }), { device: 'mobile', source: 'direct', visitorId: 'visitor-0001', viewerKind: 'staff' }), true);
  assert.equal(ok.calls[0].values[0], 'visitor-0001');
  assert.equal(ok.calls[0].values[13], 'staff');
  assert.deepEqual(ok.calls[0].values[2], ['Gombe']);
});

// --- the gallery funnel ---------------------------------------------------------

test('gallery completion needs 80% of the photos, never fewer than two, and never for a single photo', () => {
  assert.equal(galleryCompleteThreshold(1), null);
  assert.equal(galleryCompleteThreshold(0), null);
  assert.equal(galleryCompleteThreshold(2), 2);
  assert.equal(galleryCompleteThreshold(5), 4);
  assert.equal(galleryCompleteThreshold(10), 8);
});

test('the lead photo alone is not engagement; swiping or opening the viewer is, once', () => {
  let state = initialGalleryState();
  let step = noteGalleryStep(state, { index: 0, total: 5, engaged: false });
  assert.deepEqual(step.events, []);
  state = step.state;

  step = noteGalleryStep(state, { index: 1, total: 5, engaged: false });
  assert.deepEqual(step.events, ['gallery_open']);
  state = step.state;

  step = noteGalleryStep(state, { index: 1, total: 5, engaged: true });
  assert.deepEqual(step.events, [], 'gallery_open is sent once');
  state = step.state;

  for (const index of [2, 3]) state = noteGalleryStep(state, { index, total: 5, engaged: true }).state;
  assert.equal(state.completed, true, '4 of 5 distinct photos is 80%');
});

test('opening the viewer on the lead photo counts as opening the gallery', () => {
  const { events } = noteGalleryStep(initialGalleryState(), { index: 0, total: 3, engaged: true });
  assert.deepEqual(events, ['gallery_open']);
});

test('reaching the end emits both steps at once when the visitor jumps straight there', () => {
  const { events } = noteGalleryStep(initialGalleryState(), { index: 1, total: 2, engaged: true });
  assert.deepEqual(events, ['gallery_open', 'gallery_complete']);
});

test('the client and the server read a listing id off a URL the same way', () => {
  assert.equal(clientListingIdFromPath('https://lukkaplace.com/listings/310?utm_source=wa_status'), 310);
  assert.equal(clientListingIdFromPath('/listings/310#photos'), 310);
  assert.equal(clientListingIdFromPath('/projets/12'), null);
  assert.equal(listingIdFromPath('/listings/310'), clientListingIdFromPath('/listings/310'));
});
