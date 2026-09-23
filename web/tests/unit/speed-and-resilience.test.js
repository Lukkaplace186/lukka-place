import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memo, forget } from '@/lib/memo';
import { actionFailureToast } from '@/lib/actionFailure';
import * as listings from '@/lib/listings';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * 2026-09-23 speed and agent-reliability pass: the 60-second memo, the toast
 * for a Server Action that rejected, the "aussi à proximité" row, and the
 * dashboard pieces that must survive the engine being down.
 */

const t = (key) => key;

test.beforeEach(() => reset());

test('memo shares one in-flight read and serves it until it expires', async () => {
  forget('t:');
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads;
  };
  const [a, b] = await Promise.all([memo('t:x', 60_000, load), memo('t:x', 60_000, load)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await memo('t:x', 60_000, load), 1);
  assert.equal(loads, 1);
  assert.equal(await memo('t:y', -1, load), 2, 'an expired entry reloads');
  assert.equal(await memo('t:y', -1, load), 3);
});

test('memo never keeps a failed read', async () => {
  forget('t:');
  let calls_ = 0;
  const flaky = async () => {
    calls_ += 1;
    if (calls_ === 1) throw new Error('db down');
    return 'ok';
  };
  await assert.rejects(memo('t:flaky', 60_000, flaky));
  assert.equal(await memo('t:flaky', 60_000, flaky), 'ok');
});

test('a dropped connection offers a retry; anything else says the session may have expired', () => {
  const retry = () => {};
  const offline = actionFailureToast(t, new TypeError('Failed to fetch'), retry);
  assert.equal(offline.message, 'agent.actionError.offline');
  assert.equal(offline.action.onClick, retry);

  const original = console.error;
  console.error = () => {};
  try {
    const other = actionFailureToast(t, new Error('Not authenticated'), retry);
    assert.equal(other.message, 'agent.actionError.failed');
    assert.equal(other.action, null, 'no blind retry when the cause is not the network');
  } finally {
    console.error = original;
  }
});

test('every new message exists in both dictionaries', () => {
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(readFileSync(new URL(`../../lib/i18n/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of ['offline', 'failed', 'retry']) assert.ok(dict.agent.actionError[key], `${lang} agent.actionError.${key}`);
    assert.ok(dict.agent.leads.unavailable, `${lang} agent.leads.unavailable`);
    for (const key of ['label', 'previous', 'next', 'pageOf']) assert.ok(dict.agent.listings.pager[key], `${lang} pager.${key}`);
    assert.ok(dict.listings.results.nearbyExtrasTitle, `${lang} nearbyExtrasTitle`);
  }
});

test('"aussi à proximité" leaves out what the page already shows and keeps the public gate', async () => {
  const origin = KINSHASA_COMMUNE_CENTROIDS.Lemba;
  enqueue([
    { id: 5, lat: origin.lat, lng: origin.lng, commune: 'Lemba' }, // already on the page
    { id: 7, lat: origin.lat + 0.02, lng: origin.lng, commune: 'Limete' },
  ]);
  enqueue([{ id: 7, title: 'Limete flat' }]);

  const extras = await listings.getNearbyExtras({ commune: 'Lemba', propertyType: 'appartement' }, [5]);

  assert.deepEqual(extras.listings.map((l) => l.id), [7]);
  for (const call of calls) assert.ok(call.sql.includes('p.status = 1 AND p.approve_status = 1'));
  assert.ok(!calls[0].values.includes('Lemba'), 'distance, not the commune tag, decides');
});

test('no place searched, no nearby row', async () => {
  assert.equal(await listings.getNearbyExtras({ propertyType: 'maison' }, []), null);
  assert.equal(calls.length, 0);
});

test('the agent dashboard reads engine data defensively', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  assert.match(read('lib/agentDashboard.js'), /Promise\.allSettled/);
  assert.match(read('app/compte/agent/demandes/page.js'), /leadsUnavailable/);
  assert.match(read('app/compte/agent/page.js'), /recent leads unavailable/);
});
