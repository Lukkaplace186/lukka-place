import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset, normalizeSql } from '../support/fakePool.js';
import {
  STATUS_LISTINGS_SQL,
  STATUS_WRITES,
  answerListingStatus,
  hashStatusToken,
  isStatusToken,
  positiveAmount,
  resolveStatusRequest,
  validClosingDate,
} from '@/lib/statusCheck';

/**
 * "Faites le point sur vos annonces" (lib/statusCheck.js): one page per agent
 * from the engine's WhatsApp link. What matters is what the SQL refuses
 * (another agent's listing, a listing no longer in the state an answer
 * applies to), that the link is matched by its hash only, and that a close
 * without a price never invents one.
 */

const root = path.resolve(import.meta.dirname, '..', '..');
const NOW = new Date('2026-11-09T12:00:00Z');
const TOKEN = 'A'.repeat(32);

beforeEach(() => reset());

test('a link token is 32 base64url characters and only its SHA-256 is looked up', async () => {
  assert.equal(isStatusToken(TOKEN), true);
  assert.equal(isStatusToken('short'), false);
  assert.equal(isStatusToken(`${'A'.repeat(31)}/`), false);
  assert.equal(await resolveStatusRequest('../../etc'), null);
  assert.equal(calls.length, 0, 'a malformed token never reaches the database');

  enqueue([{ id: 7, agent_id: 42, created_at: '2026-11-08T09:00:00Z', expires_at: '2026-11-15T09:00:00Z', first_name: 'Patrick' }]);
  const request = await resolveStatusRequest(TOKEN, NOW);
  assert.deepEqual(request, { requestId: 7, agentId: 42, firstName: 'Patrick', createdAt: '2026-11-08T09:00:00.000Z', expired: false });
  assert.deepEqual(calls[0].values, [hashStatusToken(TOKEN)]);
  assert.ok(!calls[0].values.includes(TOKEN), 'the raw token is never sent to the database');
  assert.match(normalizeSql(calls[0].text), /a\.status = 1 AND \(to_jsonb\(a\) ->> 'deleted_at'\) IS NULL/);
});

test('an expired link resolves as expired, so the page can say so', async () => {
  enqueue([{ id: 7, agent_id: 42, created_at: '2026-10-01T09:00:00Z', expires_at: '2026-10-08T09:00:00Z' }]);
  assert.equal((await resolveStatusRequest(TOKEN, NOW)).expired, true);
});

test('the board lists only the agent\'s own public listings, active or under offer, never project units', () => {
  const sql = normalizeSql(STATUS_LISTINGS_SQL);
  assert.match(sql, /WHERE p\.agent_id = \$1 AND \(p\.status = 1 OR \(p\.status = 0 AND \(to_jsonb\(p\) ->> 'auto_paused_at'\) IS NOT NULL AND p\.archived_at IS NULL\)\) AND p\.approve_status = 1/);
  assert.match(sql, /COALESCE\(p\.listing_status, 'active'\) IN \('active', 'under_offer'\)/);
  assert.match(sql, /development_id'\) IS NULL/);
});

test('every write names the agent and the state its answer applies to', () => {
  for (const [name, sql] of Object.entries(STATUS_WRITES)) {
    const text = normalizeSql(sql);
    const paused = ['reactivate', 'closed_paused', 'withdrawn_paused'].includes(name);
    assert.match(text, paused
      ? /WHERE p\.id = \$1 AND p\.agent_id = \$2 AND p\.status = 0 AND \(to_jsonb\(p\) ->> 'auto_paused_at'\) IS NOT NULL AND p\.archived_at IS NULL AND p\.approve_status = 1/
      : /WHERE p\.id = \$1 AND p\.agent_id = \$2 AND p\.status = 1 AND p\.approve_status = 1/, name);
  }
  assert.match(normalizeSql(STATUS_WRITES.available), /COALESCE\(p\.listing_status, 'active'\) = 'active'/);
  assert.match(normalizeSql(STATUS_WRITES.still_under_offer), /p\.listing_status = 'under_offer'/);
  assert.match(normalizeSql(STATUS_WRITES.back_on_market), /SET listing_status = 'active'/);
  assert.match(normalizeSql(STATUS_WRITES.withdrawn), /SET status = 0, archived_at = NOW\(\)/);
  assert.doesNotMatch(normalizeSql(STATUS_WRITES.withdrawn), /listing_status = 'closed'/, 'a withdrawal is never a transaction');
});

test('"Disponible" on an under-offer listing puts it back on the market', async () => {
  enqueue([{ listing_status: 'under_offer', status: 1, approve_status: 1, created_at: '2026-10-01T00:00:00Z', price: '900' }]);
  enqueue([{ price: '900' }]);
  const result = await answerListingStatus({ agentId: 42, propertyId: 310, answer: 'available', now: NOW });
  assert.deepEqual(result, { ok: true, state: 'active', freedSlot: null });
  assert.match(normalizeSql(calls[1].text), /SET listing_status = 'active'/);
  const record = calls.find((c) => /INSERT INTO listing_availability_checks/.test(c.text));
  assert.equal(record.values[2], 'DASHBOARD');
  assert.equal(record.values[4], 'BACK_ON_MARKET');
});

test('a close with a price writes it with its provenance; without one, sold_price stays NULL', async () => {
  enqueue([{ listing_status: 'active', status: 1, approve_status: 1, created_at: '2026-10-01T00:00:00Z', price: '1200' }]);
  enqueue([{ price: '1200' }]);
  const request = { requestId: 9, createdAt: '2026-11-08T09:00:00.000Z' };
  const priced = await answerListingStatus({
    agentId: 42, request, propertyId: 310, answer: 'closed', now: NOW,
    closing: { soldPrice: '1 100', soldAt: '2026-11-05', viaPlatform: true },
  });
  assert.equal(priced.ok, true);
  assert.equal(priced.state, 'closed');
  const write = calls[1];
  assert.deepEqual(write.values, [310, 42, 1100, '2026-11-05', 'DIRECT_INPUT']);
  const record = calls.find((c) => /INSERT INTO listing_availability_checks/.test(c.text));
  assert.deepEqual([record.values[2], record.values[3], record.values[4], record.values[7], record.values[8], record.values[9]],
    ['LINK', '2026-11-08T09:00:00.000Z', 'LET_OR_SOLD', 1100, true, 9]);

  reset();
  enqueue([{ listing_status: 'active', status: 1, approve_status: 1, created_at: '2026-10-01T00:00:00Z', price: '1200' }]);
  enqueue([{ price: '1200' }]);
  const unpriced = await answerListingStatus({
    agentId: 42, propertyId: 310, answer: 'closed', now: NOW, closing: { soldPrice: null, soldAt: '2026-11-05' },
  });
  assert.equal(unpriced.ok, true);
  assert.deepEqual(calls[1].values, [310, 42, null, '2026-11-05', null], 'no price, no provenance — nothing invented');
});

test('a closing date in the future or before publication is refused before any write', async () => {
  enqueue([{ listing_status: 'active', status: 1, approve_status: 1, created_at: '2026-10-01T00:00:00Z', price: '1200' }]);
  const result = await answerListingStatus({ agentId: 42, propertyId: 310, answer: 'closed', now: NOW, closing: { soldAt: '2026-12-01' } });
  assert.deepEqual(result, { ok: false, reason: 'bad_date' });
  assert.equal(calls.length, 1);
  assert.equal(validClosingDate('2026-09-30', '2026-10-01', NOW), null);
  assert.equal(validClosingDate('2026-02-30', null, NOW), null);
  assert.equal(validClosingDate('2026-11-09', '2026-10-01', NOW), '2026-11-09');
});

test('another agent\'s listing, or one already updated, changes nothing', async () => {
  enqueue([]);
  assert.deepEqual(await answerListingStatus({ agentId: 42, propertyId: 999, answer: 'available', now: NOW }), { ok: false, reason: 'not_found' });
  reset();
  enqueue([{ listing_status: 'active', status: 1, approve_status: 1, created_at: '2026-10-01T00:00:00Z', price: '1200' }]);
  enqueue([]);
  assert.deepEqual(await answerListingStatus({ agentId: 42, propertyId: 310, answer: 'under_offer', now: NOW }), { ok: false, reason: 'stale' });
  assert.ok(!calls.some((c) => /INSERT INTO listing_availability_checks/.test(c.text)), 'nothing recorded for a refused answer');
});

test("a paused listing is reactivated by Disponible unless the plan is full; an archived one is never touched", async () => {
  const pausedRow = { listing_status: 'active', status: 0, approve_status: 1, created_at: '2026-09-01T00:00:00Z', price: '700', archived_at: null, auto_paused_at: '2026-11-01T05:00:00Z' };
  enqueue([pausedRow]);
  enqueue([{ listing_limit: 5, used: 2, plan_title: 'Pro' }]);
  enqueue([{ price: '700' }]);
  const ok = await answerListingStatus({ agentId: 42, propertyId: 311, answer: 'available', now: NOW });
  assert.deepEqual(ok, { ok: true, state: 'active', freedSlot: null });
  assert.match(normalizeSql(calls[2].text), /SET status = 1, auto_paused_at = NULL/);

  reset();
  enqueue([pausedRow]);
  enqueue([{ listing_limit: 2, used: 2, plan_title: 'Free' }]);
  assert.deepEqual(await answerListingStatus({ agentId: 42, propertyId: 311, answer: 'available', now: NOW }), { ok: false, reason: 'quota' });
  assert.equal(calls.length, 2, 'refused before any write');

  reset();
  enqueue([{ ...pausedRow, archived_at: '2026-11-02T00:00:00Z' }]);
  enqueue([]);
  const archived = await answerListingStatus({ agentId: 42, propertyId: 311, answer: 'available', now: NOW });
  assert.equal(archived.ok, false, 'an archived listing is not "paused" and is not reactivated here');
});

test('amounts: blank or "ne pas dire" is null, spaces and commas are read', () => {
  assert.equal(positiveAmount(''), null);
  assert.equal(positiveAmount(null), null);
  assert.equal(positiveAmount('0'), null);
  assert.equal(positiveAmount('1 100'), 1100);
  assert.equal(positiveAmount('850,5'), 850.5);
});

test('the link page is never indexed and the board stays French with the confidentiality line', () => {
  const page = readFileSync(path.join(root, 'app', '(site)', 'point', '[token]', 'page.js'), 'utf8');
  assert.match(page, /index: false/);
  assert.match(page, /force-dynamic/);
  const board = readFileSync(path.join(root, 'components', 'statusCheck', 'StatusCheckBoard.js'), 'utf8');
  assert.match(board, /Ces chiffres restent confidentiels/);
  assert.match(board, /Je préfère ne pas dire le prix/);
  assert.doesNotMatch(board, /repère/i);
});

test('the engine and web agree on the link format and the 14-day cycle', () => {
  const engine = readFileSync(path.join(root, '..', 'services', 'agentStatusCheck.js'), 'utf8');
  assert.match(engine, /randomBytes\(24\)\.toString\('base64url'\)/, '24 bytes = 32 base64url characters, what isStatusToken accepts');
  assert.match(engine, /\/point\/\$\{token\}/);
  assert.match(engine, /createHash\('sha256'\)/);
});
