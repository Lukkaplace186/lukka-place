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
  assert.match(start, /target = '\/compte\/agent'/);
  assert.match(start, /let target = '\/'/);
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
