// Measurement fixes (2026-11-21): the landing query on page views, Plausible
// goals, and an ad CompleteRegistration for agent sign-ups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { LANDING_QUERY_KEYS, LANDING_QUERY_MAX, cleanLandingQuery } from '@/lib/landingQuery';
import {
  RECORD_PAGE_VIEW_CAMPAIGN_SQL, RECORD_PAGE_VIEW_QUERY_SQL, recordPageView, resetPageViewQueryColumnCache,
} from '@/lib/trackIngest';
import {
  GOAL_QUEUE_COOKIE, PLAUSIBLE_GOALS, appendGoalQueue, cleanGoalProps, firePlausibleGoal, parseGoalQueue,
} from '@/lib/plausibleGoals';
import { REGISTRATION_KINDS, registrationAdEvent, registrationContent, registrationParams } from '@/lib/adTrackingRules';
import { metaPayload } from '@/lib/adServerEvents';

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function recordingPool({ failCodes = [] } = {}) {
  const calls = [];
  const pending = [...failCodes];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: squash(sql), values });
      const code = pending.shift();
      if (code) {
        const err = new Error(`simulated ${code}`);
        err.code = code;
        throw err;
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

// --- 1. the landing query string -----------------------------------------------

test('landing query: search filters and utm_* are kept, in the order received', () => {
  assert.equal(
    cleanLandingQuery('?ville=toutes&transaction_type=location&utm_source=fb&utm_campaign=120211'),
    'ville=toutes&transaction_type=location&utm_source=fb&utm_campaign=120211',
  );
  assert.equal(cleanLandingQuery('https://lukkaplace.com/listings?commune=Gombe&price_max=800#map'), 'commune=Gombe&price_max=800');
  assert.equal(cleanLandingQuery(new URLSearchParams('beds_min=2')), 'beds_min=2');
  for (const empty of ['', '?', null, undefined, '?fbclid=abc']) assert.equal(cleanLandingQuery(empty), null);
});

test('landing query: anything that could carry personal data is dropped — whitelist, not blacklist', () => {
  const dropped = ['phone', 'name', 'token', 'code', 'otp', 'q', 'email', 'fbclid', 'gclid', 'ttclid', 'near', 'ids',
    'sw_lat', 'ne_lng', 'ref', 'next', 'reference'];
  for (const key of dropped) assert.ok(!LANDING_QUERY_KEYS.includes(key), `${key} is not whitelisted`);
  assert.equal(
    cleanLandingQuery('?phone=243812345678&name=Marie&token=abc&code=123456&q=appel+moi&ville=kinshasa'),
    'ville=kinshasa',
  );
  // A phone-shaped value is never stored, even under a whitelisted key.
  assert.equal(cleanLandingQuery('?utm_content=243812345678&utm_source=fb'), 'utm_source=fb');
  assert.equal(cleanLandingQuery('?utm_term=%2B243%20812%20345%20678'), null);
  // One value per key; an over-long value is left out.
  assert.equal(cleanLandingQuery('?commune=Gombe&commune=Limete'), 'commune=Gombe');
  assert.equal(cleanLandingQuery(`?utm_campaign=${'x'.repeat(81)}&ville=toutes`), 'ville=toutes');
});

test('landing query: capped at 400 characters by dropping whole pairs', () => {
  const long = LANDING_QUERY_KEYS.map((key) => `${key}=${'v'.repeat(30)}`).join('&');
  const out = cleanLandingQuery(long);
  assert.ok(out.length <= LANDING_QUERY_MAX);
  for (const pair of out.split('&')) assert.match(pair, /^[a-z_]+=v{30}$/);
});

test('a page view with a landing query stores it; without one the INSERT is unchanged', async () => {
  resetPageViewQueryColumnCache();
  const pool = recordingPool();
  await recordPageView(pool, {
    path: '/listings', device: 'mobile', source: 'facebook', viewerKind: 'visitor',
    query: 'ville=toutes&transaction_type=location&phone=243812345678',
  });
  assert.equal(pool.calls.length, 1);
  assert.equal(pool.calls[0].sql, squash(RECORD_PAGE_VIEW_QUERY_SQL));
  assert.match(pool.calls[0].sql, /ref_code, query\) VALUES/);
  assert.equal(pool.calls[0].values[15], 'ville=toutes&transaction_type=location', 'the server cleans the body again');

  const plain = recordingPool();
  await recordPageView(plain, { path: '/', device: 'mobile', source: 'direct', viewerKind: 'visitor' });
  assert.equal(plain.calls[0].sql, squash(RECORD_PAGE_VIEW_CAMPAIGN_SQL));
});

test('before the migration the query tier falls back, and is skipped for a minute after', async () => {
  resetPageViewQueryColumnCache();
  const pool = recordingPool({ failCodes: ['42703'] });
  const written = await recordPageView(pool, {
    path: '/listings', device: 'mobile', source: 'direct', viewerKind: 'visitor', query: 'ville=toutes',
  });
  assert.equal(written, true);
  assert.deepEqual(pool.calls.map((c) => c.sql), [squash(RECORD_PAGE_VIEW_QUERY_SQL), squash(RECORD_PAGE_VIEW_CAMPAIGN_SQL)]);
  const next = recordingPool();
  await recordPageView(next, { path: '/listings', device: 'mobile', source: 'direct', viewerKind: 'visitor', query: 'ville=toutes' });
  assert.equal(next.calls[0].sql, squash(RECORD_PAGE_VIEW_CAMPAIGN_SQL), 'no failing INSERT per page view');
  resetPageViewQueryColumnCache();
  const other = recordingPool({ failCodes: ['23514'] });
  await assert.rejects(recordPageView(other, { path: '/', device: 'mobile', source: 'direct', query: 'ville=toutes' }));
  resetPageViewQueryColumnCache();
});

test('the trackers send the whitelisted landing query; the route passes it on; the migration is idempotent', () => {
  for (const file of ['components/SitePageViewTracker.js', 'components/ListingViewTracker.js']) {
    const src = read(file);
    assert.match(src, /cleanLandingQuery\(window\.location\.search\)/, file);
    assert.match(src, /\.\.\.\(query \? \{ query \} : \{\}\)/, file);
  }
  assert.match(read('app/api/track/route.js'), /query: typeof body\?\.query === 'string' \? body\.query\.slice\(0, 2000\) : null/);
  const migration = readFileSync(path.join(process.cwd(), '..', 'migrations/20261121_page_views_query.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE page_views ADD COLUMN IF NOT EXISTS query text;/);
  assert.match(migration, /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
  assert.match(migration, /char_length\(query\) <= 400\) NOT VALID/);
});

// --- 2. Plausible goals ----------------------------------------------------------

test('Plausible: three goal names, fired through window.plausible and never throwing', () => {
  assert.deepEqual(Object.values(PLAUSIBLE_GOALS), ['WhatsApp tap', 'Account created', 'Alert created']);
  const sent = [];
  globalThis.window = { plausible: (...args) => sent.push(args) };
  try {
    assert.equal(firePlausibleGoal('WhatsApp tap', { placement: 'card', count: 3, 'bad key': 'x', long: 'y'.repeat(61) }), true);
    assert.deepEqual(sent[0], ['WhatsApp tap', { props: { placement: 'card', count: 3 } }]);
    assert.equal(firePlausibleGoal('Account created'), true);
    assert.deepEqual(sent[1], ['Account created', undefined]);
    assert.equal(firePlausibleGoal('Something else'), false, 'unknown names are ignored');
    // Before Plausible's stub exists: its queue shim is installed and the call queued.
    globalThis.window = {};
    assert.equal(firePlausibleGoal('Alert created'), true);
    assert.equal(globalThis.window.plausible.q.length, 1);
    // A broken Plausible changes nothing for the visitor.
    globalThis.window = { plausible: () => { throw new Error('blocked'); } };
    assert.equal(firePlausibleGoal('WhatsApp tap'), false);
  } finally {
    delete globalThis.window;
  }
  assert.equal(firePlausibleGoal('WhatsApp tap'), false, 'no window on the server');
  assert.equal(cleanGoalProps({ x: '' }), null);
});

test('Plausible: the server queue cookie holds known goal names only, at most five', () => {
  let value = appendGoalQueue(undefined, 'Account created', { method: 'password' });
  value = appendGoalQueue(value, 'Not a goal');
  assert.deepEqual(parseGoalQueue(value), [{ n: 'Account created', p: { method: 'password' } }]);
  for (let i = 0; i < 7; i += 1) value = appendGoalQueue(value, 'Alert created');
  assert.equal(parseGoalQueue(value).length, 5);
  assert.deepEqual(parseGoalQueue('garbage%'), []);
  assert.deepEqual(parseGoalQueue(encodeURIComponent(JSON.stringify(['WhatsApp tap', { n: 'x' }]))), [{ n: 'WhatsApp tap' }]);
  assert.equal(GOAL_QUEUE_COOKIE, 'lp_goal');
});

test('Plausible goals fire only on a confirmed success', () => {
  // WhatsApp tap: where trackLeadClick fires.
  const client = read('lib/analyticsClient.js');
  const lead = client.slice(client.indexOf('export function trackLeadClick'));
  assert.match(lead.slice(0, 600), /firePlausibleGoal\(PLAUSIBLE_GOALS\.WHATSAPP_TAP/);
  // Alert created: only when the server answered `added`, not on the optimistic save.
  const favorites = read('lib/accountFavorites.js');
  assert.match(favorites, /if \(body\?\.status === 'added'\) firePlausibleGoal\(PLAUSIBLE_GOALS\.ALERT_CREATED\)/);
  assert.ok(favorites.indexOf("body?.status === 'added'") > favorites.indexOf('if (!res.ok)'));
  assert.match(read('app/api/account/saved-searches/route.js'), /return NextResponse\.json\(\{ ok: true, status \}\);/);
  for (const file of ['app/(site)/compte/inscription/actions.js', 'app/(site)/compte/connexion/actions.js', 'app/(site)/compte/client/projet/actions.js']) {
    assert.match(read(file), /alert === 'added'\) await queuePlausibleGoal\(PLAUSIBLE_GOALS\.ALERT_CREATED/, file);
  }
  // Account created: after the account exists (and its session), never on a submit.
  const signup = read('app/(site)/compte/inscription/actions.js');
  const goalAt = signup.indexOf('queuePlausibleGoal(PLAUSIBLE_GOALS.ACCOUNT_CREATED');
  assert.ok(goalAt > signup.indexOf('customer = await createCustomer('));
  assert.ok(goalAt > signup.indexOf('await establishCustomerSession('));
  const activate = read('app/(site)/compte/activer/actions.js');
  assert.ok(activate.indexOf('queuePlausibleGoal(PLAUSIBLE_GOALS.ACCOUNT_CREATED') > activate.indexOf('if (!customer) redirect('));
  // The queue is drained on the next page, from the root layout.
  assert.match(read('app/layout.js'), /<PlausibleGoals \/>/);
  const drainer = read('components/PlausibleGoals.js');
  assert.match(drainer, /^'use client';/);
  assert.match(drainer, /Max-Age=0/, 'each goal fires once');
  assert.match(read('lib/plausibleGoalServer.js'), /isDemoPhone\(phone\)/, 'a demo account is never counted');
});

// --- 3. agent sign-up ad event ---------------------------------------------------

test('CompleteRegistration: reg-c- for customers, reg-a- for agents, told apart by content', () => {
  assert.deepEqual(registrationAdEvent('agent', 42), {
    name: 'CompleteRegistration', eventId: 'reg-a-42', params: { contentName: 'Compte agent', contentCategory: 'agent' },
  });
  assert.equal(registrationAdEvent('customer', '7').eventId, 'reg-c-7');
  assert.equal(registrationAdEvent('landlord', 1), null);
  assert.equal(registrationAdEvent('agent', 0), null);
  assert.equal(registrationAdEvent('agent', 'x'), null);
  assert.deepEqual(registrationParams('customer'), { contentName: 'Compte client', contentCategory: 'customer' });
  assert.deepEqual(registrationContent({ contentName: 'Free text', contentCategory: 'agent' }), { content_category: 'agent' });
  assert.equal(Object.keys(REGISTRATION_KINDS).length, 2);

  const user = { ip: '1.2.3.4', userAgent: 'UA', visitorId: null, phone: null, fbp: null, fbc: null };
  const meta = metaPayload({ name: 'CompleteRegistration', eventId: 'reg-a-42', eventTime: 1, url: null, user, params: registrationParams('agent') });
  assert.deepEqual(meta.data[0].custom_data, { content_name: 'Compte agent', content_category: 'agent' });
  assert.equal(meta.data[0].event_id, 'reg-a-42');
  // The browser copy carries the same content (same id comes from the queue cookie).
  assert.match(read('lib/adEvents.js'), /Object\.assign\(metaParams, registrationContent\(params\)\)/);
});

test('the agent event fires on the first proof of the number, never on the form submit', () => {
  const form = read('app/(site)/compte/agent/inscription/actions.js');
  assert.doesNotMatch(form, /recordAdEventFromAction|registrationAdEvent/, 'the sign-up form only creates an unproven row');

  const code = read('app/(site)/compte/agent/inscription/verifier/actions.js');
  assert.match(code, /phone_verified_at FROM agents WHERE id = \$1/);
  assert.match(code, /if \(!agent\.phone_verified_at\) await recordAdEventFromAction\(\{ \.\.\.registrationAdEvent\('agent', agent\.id\)/);
  assert.ok(code.indexOf("registrationAdEvent('agent'") > code.indexOf('await consumeAgentOtp(agent.id)'));

  const wa = read('app/(site)/compte/whatsappVerifyActions.js');
  assert.match(wa, /SELECT phone, phone_verified_at FROM agents WHERE id = \$1/);
  assert.match(wa, /if \(before\.rows\[0\] && !before\.rows\[0\]\.phone_verified_at\) \{\s*await recordAdEventFromAction\(\{ \.\.\.registrationAdEvent\('agent', attempt\.id\)/);
  assert.ok(wa.indexOf('SELECT phone, phone_verified_at') < wa.indexOf('await consumeAgentOtp(attempt.id)'), 'read before it is stamped');

  const login = read('app/(site)/compte/agent/connexion/actions.js');
  const finish = login.slice(login.indexOf('consumeProofAtLogin({'));
  assert.match(finish.slice(0, 500), /registrationAdEvent\('agent', agent\.id\)/);

  // Customers keep their ids, now with their content.
  for (const file of ['app/(site)/compte/inscription/actions.js', 'app/(site)/compte/activer/actions.js',
    'app/(site)/compte/inscription/verifier/actions.js', 'app/(site)/compte/whatsappVerifyActions.js']) {
    assert.match(read(file), /eventId: `reg-c-\$\{[a-z]+\.id\}`, phone[^}]*, params: registrationParams\('customer'\) \}/, file);
  }
  // A no-op without a Meta pixel id (or TikTok id): nothing is posted.
  const server = read('lib/adServerEvents.js');
  assert.match(server, /if \(settings\.metaPixelId && process\.env\.META_CAPI_TOKEN\)/);
  assert.match(server, /if \(settings\.tiktokPixelId && process\.env\.TIKTOK_EVENTS_TOKEN\)/);
});
