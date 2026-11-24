import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUSTOMER_CATEGORIES,
  PUSH_PLATFORMS,
  parseId,
  parseRegistration,
  parseSide,
  safeAgentPath,
  safeCustomerPath,
  switchableCustomerCategory,
} from '@/lib/pushRules';
import {
  countUnreadNotifications,
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  openNotification,
  registerDevice,
  revokeDevice,
  setNotificationPreference,
} from '@/lib/pushNotifications';
import { alertTarget } from '@/lib/appBridge';
import { calls, enqueue, getPool, normalizeSql, reset } from '../support/fakePool.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const TOKEN = 'fcm-token-'.padEnd(160, 'x');

test('a registration needs a real token and a store platform', () => {
  assert.deepStrictEqual(parseRegistration({ token: TOKEN, platform: 'Android', appVersion: '1.0.3' }), {
    token: TOKEN, platform: 'android', appVersion: '1.0.3',
  });
  assert.equal(parseRegistration({ token: 'short', platform: 'android' }), null);
  assert.equal(parseRegistration({ token: `${TOKEN} x`, platform: 'android' }), null, 'no whitespace');
  assert.equal(parseRegistration({ token: TOKEN, platform: 'web' }), null, 'only the store apps register');
  assert.equal(parseRegistration({ token: TOKEN, platform: 'ios', appVersion: '<script>' }).appVersion, null);
  assert.equal(parseRegistration(null), null);
  assert.deepStrictEqual(PUSH_PLATFORMS, ['android', 'ios']);
  assert.equal(parseSide('customer'), 'customer');
  assert.equal(parseSide('admin'), 'agent', 'anything else is the agent side, never a third one');
});

test('a tapped alert only ever opens a page of its own side', () => {
  assert.equal(safeAgentPath('/compte/agent/demandes?visite=12'), '/compte/agent/demandes?visite=12');
  assert.equal(safeAgentPath('https://evil.example/compte/agent'), '/compte/agent/alertes');
  assert.equal(safeAgentPath('//evil.example'), '/compte/agent/alertes');
  assert.equal(safeAgentPath('/admin'), '/compte/agent/alertes');
  assert.equal(safeAgentPath(null), '/compte/agent/alertes');
  assert.equal(safeCustomerPath('/compte/client/visites'), '/compte/client/visites');
  assert.equal(safeCustomerPath('/messages/4'), '/messages/4');
  assert.equal(safeCustomerPath('/listings/685'), '/listings/685');
  assert.equal(safeCustomerPath('/compte/agent'), '/compte/client/notifications', 'a customer alert never opens the agent space');
  assert.equal(safeCustomerPath('/messagesX'), '/compte/client/notifications');
  assert.equal(safeCustomerPath('https://evil.example/listings/1'), '/compte/client/notifications');
  assert.equal(alertTarget({ notificationId: '42', url: '/compte/agent/messages/3' }), '/compte/agent/alertes/42');
  assert.equal(alertTarget({ notificationId: '42', audience: 'customer' }), '/compte/client/notifications/42');
  assert.equal(alertTarget({ url: '/compte/agent/messages/3' }), '/compte/agent/messages/3');
  assert.equal(alertTarget({ url: '/listings/9', audience: 'customer' }), '/listings/9');
  assert.equal(alertTarget({ url: 'https://evil.example' }), '/compte/agent/alertes');
  assert.equal(parseId('12'), 12);
  assert.equal(parseId('12abc'), null);
  assert.equal(parseId('-3'), null);
});

test('registering re-points a token to the signed-in account and revives it', async () => {
  reset();
  assert.equal(await registerDevice('customer', 7, { token: TOKEN, platform: 'android', appVersion: null }), 'ok');
  const { sql, values } = calls[0];
  assert.match(sql, /INSERT INTO push_devices .* ON CONFLICT \(fcm_token\) DO UPDATE/);
  assert.match(sql, /user_type = EXCLUDED\.user_type/);
  assert.match(sql, /revoked_at = NULL/);
  assert.deepStrictEqual(values, [7, 'android', TOKEN, null, 'customer']);
  await assert.rejects(() => registerDevice('admin', 7, { token: TOKEN, platform: 'ios' }), /unknown user type/);
});

test('every inbox statement is scoped to the account from the session, user type included', async () => {
  for (const userType of ['agent', 'customer']) {
    reset();
    enqueue([{ id: 9, kind: 'chat', title: 'T', body: 'B', url: '/messages/1', created_at: new Date('2026-11-10T08:00:00Z'), read_at: null }]);
    const page = await listNotifications(userType, 7);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].read, false);
    enqueue([{ n: 3 }]);
    assert.equal(await countUnreadNotifications(userType, 7), 3);
    enqueue([{ url: '/messages/1' }]);
    assert.deepStrictEqual(await openNotification(userType, 7, 9), { url: '/messages/1' });
    await markAllNotificationsRead(userType, 7);
    await revokeDevice(userType, 7, TOKEN);
    for (const call of calls) {
      assert.match(call.sql, /user_type = \$\d AND user_id = \$\d/, call.sql);
      assert.ok(call.values.includes(userType), `${userType} passed to: ${call.sql}`);
      assert.ok(call.values.includes(7));
    }
  }
});

test('preferences: no row means on; a switch is an upsert for that account', async () => {
  reset();
  enqueue([{ category: 'news', push_enabled: false }]);
  assert.deepStrictEqual(await getNotificationPreferences('customer', 7), { prefs: { news: false }, available: true });
  assert.equal(await setNotificationPreference('customer', 7, 'news', true), 'ok');
  assert.match(calls[1].sql, /ON CONFLICT \(user_type, user_id, category\) DO UPDATE/);
  assert.deepStrictEqual(calls[1].values, [7, 'news', true, 'customer']);
  assert.equal(switchableCustomerCategory('news'), 'news');
  assert.equal(switchableCustomerCategory('visits'), null, 'visits cannot be switched off');
  assert.equal(switchableCustomerCategory('anything'), null);
  assert.deepStrictEqual(CUSTOMER_CATEGORIES.map((c) => c.key), ['visits', 'requests', 'messages', 'search_alerts', 'saved_listings', 'suggestions', 'news']);
});

test('before the migration nothing throws: empty inbox, zero unread, registration unavailable', async () => {
  const missing = Object.assign(new Error('relation "notifications" does not exist'), { code: '42P01' });
  const pool = getPool();
  const saved = pool.query;
  pool.query = async () => { throw missing; };
  try {
    assert.deepStrictEqual(await listNotifications('agent', 7), { items: [], nextCursor: null, available: false });
    assert.equal(await countUnreadNotifications('customer', 7), 0);
    assert.equal(await registerDevice('agent', 7, { token: TOKEN, platform: 'ios', appVersion: null }), 'unavailable');
    assert.equal(await openNotification('customer', 7, 1), null);
    assert.deepStrictEqual(await getNotificationPreferences('customer', 7), { prefs: {}, available: false });
    assert.equal(await setNotificationPreference('customer', 7, 'news', false), 'unavailable');
  } finally {
    pool.query = saved;
  }
});

test('the inbox pages with an id cursor', async () => {
  reset();
  enqueue(Array.from({ length: 31 }, (_, i) => ({ id: 100 - i, kind: 'enquiry', title: 't', body: '', url: null, created_at: '2026-11-10T08:00:00Z', read_at: null })));
  const page = await listNotifications('agent', 7, { limit: 30 });
  assert.equal(page.items.length, 30);
  assert.equal(page.nextCursor, 71);
  await listNotifications('agent', 7, { before: 71 });
  assert.match(normalizeSql(calls[1].text), /AND id < \$4/);
});

test('routes take the account from that side’s session, redirect relatively, and logouts revoke this phone', () => {
  for (const file of ['../../app/api/push/register/route.js', '../../app/api/push/unregister/route.js', '../../app/api/push/unread/route.js']) {
    assert.match(read(file), /currentPushAccount\(parseSide\(/, file);
  }
  const session = read('../../lib/pushSession.js');
  assert.match(session, /getCurrentCustomerId\(\)/);
  assert.match(session, /getCurrentChatAgentId\(\)/);
  assert.match(read('../../app/compte/agent/alertes/[id]/route.js'), /getCurrentChatAgentId\(\)/);
  assert.match(read('../../app/(site)/compte/client/notifications/[id]/route.js'), /getCurrentCustomerId\(\)/);
  for (const file of ['../../app/compte/agent/alertes/[id]/route.js', '../../app/(site)/compte/client/notifications/[id]/route.js', '../../app/app/route.js']) {
    assert.match(read(file), /Location: (path|target)/, `${file}: a relative redirect (behind the proxy request.url is localhost)`);
  }
  assert.match(read('../../app/compte/agent/actions.js'), /revokeDevice\('agent', agentId, pushToken, 'logout'\)/);
  const customerActions = read('../../app/(site)/compte/actions.js');
  assert.match(customerActions, /revokeThisPhone\(await getCurrentCustomerId\(\), 'logout'\)/);
  assert.match(customerActions, /revokeThisPhone\(customerId, 'account deleted'\)/);
});

test('the app starts at /app; agents land in their space, everyone else on the listings', () => {
  const config = JSON.parse(read('../../../mobile/capacitor.config.json'));
  assert.equal(config.server.url, 'https://lukkaplace.com/app');
  const start = read('../../app/app/route.js');
  assert.match(start, /let target = '\/'/);
  assert.match(start, /target = appStartTarget\(\{ isAgent, welcomed \}\)/);
});

// --- Phase 1: web-side customer messages go app-first -----------------------

import { pushToAccount, sendToCustomerAppFirst } from '@/lib/adminApi';
import { runFavoritePriceDropSweep } from '@/lib/favoritePriceDropSweep';

function withEngine(handler, fn) {
  const saved = { fetch: globalThis.fetch, base: process.env.ENGINE_API_BASE, key: process.env.ENGINE_API_SECRET };
  const seen = [];
  process.env.ENGINE_API_BASE = 'http://engine.test';
  process.env.ENGINE_API_SECRET = 'k';
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : null;
    seen.push({ path, body });
    const out = handler(path, body);
    return { ok: out.status === undefined || out.status < 400, status: out.status || 200, json: async () => out.body };
  };
  return Promise.resolve(fn(seen)).finally(() => {
    globalThis.fetch = saved.fetch;
    process.env.ENGINE_API_BASE = saved.base;
    process.env.ENGINE_API_SECRET = saved.key;
  });
}

test('a customer with the app gets the push and no WhatsApp now; the text rides as the late copy', async () => {
  await withEngine((path) => (path === '/admin/push' ? { body: { success: true, pushed: true } } : { body: { success: true } }), async (seen) => {
    const out = await sendToCustomerAppFirst('243906500096', 'Bonjour, *voici* https://lukkaplace.com/listings/1', {
      kind: 'agent_reply', title: 'Réponse de votre agent', url: '/compte/client/messages',
    });
    assert.deepStrictEqual(out, { via: 'push' });
    assert.deepStrictEqual(seen.map((s) => s.path), ['/admin/push']);
    const push = seen[0].body;
    assert.equal(push.userType, 'customer');
    assert.equal(push.urgent, true);
    assert.equal(push.fallbackText, 'Bonjour, *voici* https://lukkaplace.com/listings/1');
    assert.equal(push.body, 'Bonjour, voici', 'no link, no WhatsApp bold marks in the notification');
  });
});

test('no app (or the engine unreachable): WhatsApp exactly as before', async () => {
  await withEngine((path) => (path === '/admin/push' ? { body: { success: true, pushed: false, reason: 'no-device' } } : { body: { success: true } }), async (seen) => {
    assert.deepStrictEqual(await sendToCustomerAppFirst('243906500096', 'Bonjour', { kind: 'agent_reply', title: 't' }), { via: 'whatsapp' });
    assert.deepStrictEqual(seen.map((s) => s.path), ['/admin/push', '/admin/send-whatsapp']);
  });
  await withEngine((path) => (path === '/admin/push' ? { status: 500, body: { error: 'down' } } : { body: { success: true } }), async (seen) => {
    assert.deepStrictEqual(await pushToAccount({ userType: 'customer', phone: '243906500096', kind: 'x', title: 't' }), { pushed: false, reason: 'engine-unreachable' });
    assert.deepStrictEqual(await sendToCustomerAppFirst('243906500096', 'Bonjour', { kind: 'agent_reply', title: 't' }), { via: 'whatsapp' });
    assert.ok(seen.some((s) => s.path === '/admin/send-whatsapp'));
  });
});

test('price drops hand the app a title, a line and the listing to open', async () => {
  const sent = [];
  await runFavoritePriceDropSweep({
    siteUrl: 'https://lukkaplace.com',
    deps: {
      getDrops: async () => [{ customer_id: 31, phone: '243906500096', property_id: 685, title: 'Appartement Gombe', price: 900, price_drop_from: 1000, purpose: 'rent', price_period: 'mois', price_drop_at: '2026-11-09' }],
      send: async (phone, text, meta) => sent.push({ phone, text, meta }),
      recordNotified: async () => {},
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].meta.customerId, 31);
  assert.equal(sent[0].meta.push.url, '/listings/685');
  assert.match(sent[0].meta.push.title, /baisse de prix/);
});

test('the cron route pushes saved-search matches and price drops to app users only, WhatsApp for the rest', () => {
  const route = read('../../app/api/cron/search-alerts/route.js');
  assert.match(route, /if \(await pushedToApp\(phone, customerId, 'search_alert', 'search_alerts', push\)\) return;/);
  assert.match(route, /if \(await pushedToApp\(phone, customerId, 'price_drop', 'saved_listings', push\)\) return;/);
  const sweep = read('../../lib/searchAlertSweep.js');
  assert.match(sweep, /customerId: search\.customer_id/);
  for (const file of ['../../app/compte/agent/actions.js', '../../app/compte/agent/alternativesActions.js']) {
    assert.match(read(file), /sendToCustomerAppFirst\(/, file);
  }
});

// --- Phase 2 ------------------------------------------------------------------

test('WhatsApp alerts switched off: saved-search matches and price drops still reach the app, never WhatsApp', () => {
  const route = read('../../app/api/cron/search-alerts/route.js');
  const send = route.slice(route.indexOf('async function send('));
  const pushAt = send.indexOf("pushedToApp(phone, customerId, 'search_alert'");
  const optOutAt = send.indexOf('if (whatsappOptedOut) return;');
  const whatsappAt = send.indexOf('sendWhatsAppMessage(phone, text)');
  assert.ok(pushAt > -1 && optOutAt > pushAt && whatsappAt > optOutAt, 'push first, then the opt-out stops WhatsApp');
  assert.match(route, /'price_drop', 'saved_listings', push\)\) return;\s*if \(whatsappOptedOut\) return;/);
  assert.match(read('../../lib/searchAlertSweep.js'), /whatsappOptedOut: search\.whatsapp_opted_out === true/);
  assert.match(read('../../lib/favoritePriceDropSweep.js'), /whatsappOptedOut: row\.whatsapp_opted_out === true/);
});

test('an agent proposing a listing tells the customer (app first), after the write and without blocking it', () => {
  const src = read('../../app/compte/agent/actions.js');
  const action = src.slice(src.indexOf('export async function proposeListingAction'), src.indexOf('async function notifyCustomerOfProposal'));
  assert.ok(action.indexOf('createLeadProposal(') < action.indexOf('notifyCustomerOfProposal('), 'after the proposal is recorded');
  assert.match(action, /notifyCustomerOfProposal\(leadId, listing\)\.catch\(/, 'fire-and-forget');
  const notify = src.slice(src.indexOf('async function notifyCustomerOfProposal'));
  assert.match(notify, /const \{ lead \} = \(await getLead\(leadId\)\) \|\| \{\};/, 'the stored lead number, never the form');
  assert.match(notify, /kind: 'listing_proposed', category: 'requests'/);
});

test('the 24 h follow-up page: only the account’s own request, answered with the account’s numbers, never the form’s', () => {
  const page = read('../../app/(site)/compte/client/suivi/[id]/page.js');
  assert.match(page, /getAccountPhones\(session\.customerId, session\.customer\.phone\)/);
  assert.match(page, /if \(!owned\) notFound\(\);/, 'someone else’s request reads as missing');
  const action = read('../../app/(site)/compte/client/suivi/[id]/actions.js');
  assert.match(action, /const waIds = await getAccountPhones\(session\.customerId, session\.customer\.phone\);/);
  assert.match(action, /new Set\(\['YES', 'NOT_YET', 'NO_LONGER'\]\)/);
  assert.equal(safeCustomerPath('/compte/client/suivi/42'), '/compte/client/suivi/42', 'the push may open it');
});

// --- Phase 3: instant matches -------------------------------------------------

import { MAX_PER_DAY, runInstantMatchSweep } from '@/lib/instantMatchSweep';
import { getAppCustomerSearches } from '@/lib/searchAlerts';

function instantDeps(over = {}) {
  const recorded = [];
  const pushes = [];
  const deps = {
    getRecentListings: async () => [{ id: 501, publishedAt: new Date('2026-11-12T10:00:00Z') }],
    getAppSearches: async () => [{ id: 9, customer_id: 31, query: 'commune=Gombe', label: 'Gombe', created_at: '2026-11-01T00:00:00Z' }],
    getListings: async () => ({ data: [{ id: 501, title: 'Studio Gombe', price: 500, purpose: 'rent', price_period: 'mois' }] }),
    getNotified: async () => new Set(),
    countToday: async () => 0,
    push: async (alert) => { pushes.push(alert); return { pushed: true }; },
    recordNotified: async (id, ids) => recorded.push({ id, ids }),
    ...over,
  };
  return { deps, recorded, pushes };
}

test('instant match: a new listing matching an app user’s search is pushed once and recorded, so the daily alert skips it', async () => {
  const { deps, recorded, pushes } = instantDeps();
  const result = await runInstantMatchSweep({ now: new Date('2026-11-12T10:05:00Z'), deps });
  assert.equal(result.pushed, 1);
  assert.deepStrictEqual([pushes[0].kind, pushes[0].category, pushes[0].url, pushes[0].userId], ['instant_match', 'search_alerts', '/listings/501', 31]);
  assert.deepStrictEqual(recorded, [{ id: 9, ids: [501] }]);
});

test('instant match: not pushed → nothing recorded (the daily WhatsApp alert still carries it); capped per day; never a widened result', async () => {
  const notPushed = instantDeps({ push: async () => ({ pushed: false }) });
  await runInstantMatchSweep({ deps: notPushed.deps });
  assert.equal(notPushed.recorded.length, 0);
  const capped = instantDeps({ countToday: async () => MAX_PER_DAY });
  const r = await runInstantMatchSweep({ deps: capped.deps });
  assert.deepStrictEqual([r.capped, capped.pushes.length], [1, 0]);
  const relaxed = instantDeps({ getListings: async () => ({ data: [{ id: 501 }], locationRelaxed: true }) });
  await runInstantMatchSweep({ deps: relaxed.deps });
  assert.equal(relaxed.pushes.length, 0);
  const older = instantDeps({ getAppSearches: async () => [{ id: 9, customer_id: 31, query: '', label: 'x', created_at: '2026-11-12T11:00:00Z' }] });
  await runInstantMatchSweep({ now: new Date('2026-11-12T11:05:00Z'), deps: older.deps });
  assert.equal(older.pushes.length, 0, 'a listing published before the search was saved is not new to it');
});

test('instant match: only app users’ searches (a live device), switched-off searches excluded, WhatsApp opt-out irrelevant', async () => {
  reset();
  await getAppCustomerSearches();
  const { sql } = calls[0];
  assert.match(sql, /FROM push_devices d\s+WHERE d\.user_type = 'customer' AND d\.user_id = css\.customer_id AND d\.revoked_at IS NULL/);
  assert.match(sql, /<> 'off'/);
  assert.doesNotMatch(sql, /whatsapp_alerts_opted_out_at/);
  assert.match(read('../../app/api/cron/instant-alerts/route.js'), /if \(!isAuthorized\(request\)\)/);
});

// --- Phase 3, second batch ------------------------------------------------------

import {
  ENQUIRED_DROPS_SQL, FOLLOWED_SQL, NEW_PROJECTS_SQL, WEEKLY_SQL,
  pickGuide, runEnquiredPriceDrops, runFollowedAgentListings, runMonthlyMarket, runNewProjects, runWeeklySummary,
  searchCommunes, weeklyBody,
} from '@/lib/portalDigests';
import { followAgent } from '@/lib/customerFollows';

const pushRecorder = () => {
  const pushes = [];
  return { pushes, push: async (p) => { pushes.push(p); return { pushed: true }; } };
};

test('every scheduled portal alert reads app users only, applies the public gates, and never repeats itself', () => {
  for (const sql of [ENQUIRED_DROPS_SQL, WEEKLY_SQL, FOLLOWED_SQL]) {
    assert.match(sql, /FROM push_devices d\s+WHERE d\.user_type = 'customer'/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM notifications n/);
  }
  assert.match(ENQUIRED_DROPS_SQL, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(ENQUIRED_DROPS_SQL, /NOT EXISTS \(SELECT 1 FROM customer_favorites cf/, 'a saved listing’s cut is the favourites’ message');
  assert.match(ENQUIRED_DROPS_SQL, /pd\.price_drop_at > x\.since/, 'only a cut after the customer showed interest');
  assert.match(FOLLOWED_SQL, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(FOLLOWED_SQL, /f\.created_at < GREATEST\(p\.created_at/, 'only listings published after the follow');
  assert.match(NEW_PROJECTS_SQL, /d\.status = 1 AND d\.approve_status = 1/);
});

test('C2: price cuts on enquired listings are pushed with a key that stops a repeat; bad pairs are dropped', async () => {
  reset();
  enqueue([{ customer_id: 31, property_id: 9, title: 'Villa', price: 900, price_drop_from: 1000, purpose: 'rent', price_period: 'mois', ref_key: '9:202611100800' }]);
  const { pushes, push } = pushRecorder();
  const result = await runEnquiredPriceDrops({
    pairs: [{ waId: '+243 906 500 096', propertyId: 9, since: '2026-11-01T00:00:00Z' }, { waId: 'x', propertyId: 9, since: 'x' }],
    push,
  });
  assert.deepStrictEqual([result.pairs, result.pushed], [1, 1]);
  assert.deepStrictEqual(JSON.parse(calls[0].values[0]), [{ wa_id: '243906500096', property_id: 9, since: '2026-11-01T00:00:00Z' }]);
  assert.deepStrictEqual([pushes[0].kind, pushes[0].refId, pushes[0].url], ['enquired_price_drop', '9:202611100800', '/listings/9']);
});

test('C9: the weekly summary says what happened, and nothing on a quiet week', async () => {
  assert.equal(weeklyBody({ matches: 3, unread: 1 }), '3 nouveaux biens pour vos recherches · 1 message non lu.');
  assert.equal(weeklyBody({ matches: 0, unread: 0 }), null);
  reset();
  enqueue([{ customer_id: 1, matches: 2, unread: 0 }, { customer_id: 2, matches: 0, unread: 0 }]);
  const { pushes, push } = pushRecorder();
  const result = await runWeeklySummary({ push });
  assert.deepStrictEqual([result.pushed, result.quiet, pushes[0].kind], [1, 1, 'weekly_summary']);
});

test('C6: the monthly price report uses the price guide for a commune the customer searches, 2 bedrooms first', async () => {
  assert.deepStrictEqual(searchCommunes('commune=Gombe&communes=Limete,Gombe'), ['Gombe', 'Limete']);
  const guides = [
    { commune: 'Limete', beds: 1, slug: 'limete-1', median: 300, p25: 250, p75: 350, listings: 12 },
    { commune: 'Limete', beds: 2, slug: 'limete-2', median: 450, p25: 400, p75: 500, listings: 9 },
  ];
  assert.equal(pickGuide(['Kintambo', 'Limete'], guides).slug, 'limete-2');
  assert.equal(pickGuide(['Kintambo'], guides), null);
  reset();
  enqueue([{ customer_id: 5, query: 'commune=Limete' }]);
  enqueue([]);
  const { pushes, push } = pushRecorder();
  const result = await runMonthlyMarket({ push, guides });
  assert.equal(result.pushed, 1);
  assert.deepStrictEqual([pushes[0].kind, pushes[0].url], ['monthly_market', '/combien-coute/limete-2']);
  assert.match(pushes[0].body, /450 \$ \/ mois/);
});

test('C5: one new project per customer, in a commune they search, not told before', async () => {
  reset();
  enqueue([{ id: 4, slug: 'tour-gombe', name: 'Tour Gombe', commune: 'Gombe' }]);
  enqueue([{ customer_id: 5, query: 'commune=Gombe' }, { customer_id: 6, query: 'commune=Limete' }]);
  enqueue([]);
  const { pushes, push } = pushRecorder();
  const result = await runNewProjects({ push });
  assert.equal(result.pushed, 1);
  assert.deepStrictEqual([pushes[0].userId, pushes[0].url], [5, '/projets/tour-gombe']);
});

test('C4: a followed agency’s new listing is pushed; following goes through the session and a live agent', async () => {
  reset();
  enqueue([{ customer_id: 5, property_id: 77, title: 'Duplex', price: 1200, purpose: 'rent', price_period: 'mois' }]);
  const { pushes, push } = pushRecorder();
  await runFollowedAgentListings({ recentIds: [77], push });
  assert.deepStrictEqual([pushes[0].kind, pushes[0].url], ['followed_agent_listing', '/listings/77']);
  reset();
  enqueue([{ agent_id: 3 }]);
  assert.equal(await followAgent(5, 3), 'ok');
  assert.match(calls[0].sql, /FROM agents a WHERE a\.id = \$2 AND a\.deleted_at IS NULL/);
  const route = read('../../app/api/account/follows/route.js');
  assert.match(route, /const customerId = await getCurrentCustomerId\(\);/);
  const page = read('../../app/(portfolio)/agents/[id]/page.js');
  assert.match(page, /<FollowAgentButton agentId=\{agent\.id\}/);
  assert.equal(safeCustomerPath('/projets/tour-gombe'), '/projets/tour-gombe');
  assert.equal(safeCustomerPath('/combien-coute/limete-2'), '/combien-coute/limete-2');
});
