import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset, getPool } from '../support/fakePool.js';
import {
  BADGE_MAX_AGE_DAYS,
  CONFIRM_AFTER_DAYS,
  LIVE_LISTING_SQL,
  badgeConfirmationDate,
  confirmListingAvailable,
  daysBetween,
  formatConfirmationDate,
  getAvailabilityPrompts,
  getListingsNeedingConfirmation,
} from '@/lib/listingAvailability';
import { getListingById } from '@/lib/listings';

/**
 * "Toujours disponible ?" — the weekly availability check and the public
 * "Disponibilité confirmée le …" badge. What matters is what the SQL refuses
 * (another agent's listing, a hidden or closed one, a missing column) and
 * that the badge never prints a date nobody confirmed.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-09-21T12:00:00Z');
const root = path.resolve(import.meta.dirname, '..', '..');

beforeEach(() => reset());

/** Make the fake pool throw once, the way pg reports a missing column. */
function failNextQuery(code) {
  const pool = getPool();
  const original = pool.query;
  pool.query = async (text, values) => {
    pool.query = original;
    calls.push({ text, values, sql: String(text).replace(/\s+/g, ' ').trim() });
    const err = new Error('column "availability_confirmed_at" does not exist');
    err.code = code;
    throw err;
  };
}

test('the to-do contract is exactly { id, title, lastConfirmedAt, daysSince }', async () => {
  enqueue([
    {
      id: '12', title: 'Studio à Gombe', purpose: 'rent', price: 400, price_original: 400, currency: 'USD',
      availability_confirmed_at: null, baseline_at: new Date(NOW.getTime() - 23 * DAY),
    },
    {
      id: 7, title: null, purpose: 'sale', price: 90000, price_original: null, currency: 'USD',
      availability_confirmed_at: new Date(NOW.getTime() - 9 * DAY - 3600_000),
      baseline_at: new Date(NOW.getTime() - 9 * DAY - 3600_000),
    },
  ]);
  const rows = await getListingsNeedingConfirmation(33, { limit: 5, now: NOW });
  assert.deepEqual(Object.keys(rows[0]).sort(), ['daysSince', 'id', 'lastConfirmedAt', 'title']);
  assert.deepEqual(rows[0], { id: 12, title: 'Studio à Gombe', lastConfirmedAt: null, daysSince: 23 });
  // A real confirmation is returned as the real date; never a stand-in.
  assert.equal(rows[1].lastConfirmedAt, new Date(NOW.getTime() - 9 * DAY - 3600_000).toISOString());
  assert.equal(rows[1].daysSince, 9);
  assert.equal(rows[1].title, null);
});

test('the due query is scoped to the agent, live listings only, and the 7-day threshold', async () => {
  enqueue([]);
  await getListingsNeedingConfirmation(33, { limit: 5 });
  const { sql, values } = calls[0];
  assert.ok(sql.includes('p.agent_id = $1'), 'ownership must be in SQL');
  assert.ok(sql.includes(LIVE_LISTING_SQL), 'live = public gate + active market state');
  assert.ok(sql.includes('p.status = 1 AND p.approve_status = 1'));
  assert.ok(sql.includes("COALESCE(p.listing_status, 'active') = 'active'"), 'under offer / closed are not asked');
  // Never confirmed → the clock starts at the last edit, not at the epoch.
  assert.ok(sql.includes('COALESCE(p.availability_confirmed_at, GREATEST(p.created_at, p.updated_at), p.created_at)'));
  assert.ok(sql.includes('make_interval(days => $2)'));
  assert.deepEqual(values, [33, CONFIRM_AFTER_DAYS, 5]);
  assert.equal(CONFIRM_AFTER_DAYS, 7);
});

test('limit is clamped and a non-numeric agent id queries nothing', async () => {
  enqueue([]);
  await getListingsNeedingConfirmation(33, { limit: 10_000 });
  assert.equal(calls[0].values[2], 100);
  reset();
  assert.deepEqual(await getListingsNeedingConfirmation('abc'), []);
  assert.equal(calls.length, 0);
});

test('before the migration (42703) there are no prompts, not an error', async () => {
  failNextQuery('42703');
  assert.deepEqual(await getListingsNeedingConfirmation(33), []);
  failNextQuery('42703');
  assert.deepEqual(await getAvailabilityPrompts(33), []);
});

test('any other database error still surfaces', async () => {
  failNextQuery('57014');
  await assert.rejects(() => getListingsNeedingConfirmation(33));
});

test('prompt rows carry the authored price in its own currency, narrowed to one listing when asked', async () => {
  enqueue([{
    id: 5, title: 'Villa', purpose: 'rent', price: 400, price_original: 1_000_000, currency: 'cdf',
    availability_confirmed_at: null, baseline_at: new Date(NOW.getTime() - 8 * DAY),
  }]);
  const [row] = await getAvailabilityPrompts(33, { propertyId: '5', limit: 1, now: NOW });
  assert.equal(row.currency, 'CDF');
  assert.equal(row.authoredPrice, 1_000_000);
  assert.equal(row.purpose, 'rent');
  assert.ok(calls[0].sql.includes('AND p.id = $4'));
  assert.deepEqual(calls[0].values, [33, 7, 1, 5]);
});

test('confirming stamps NOW only on the agent\'s own live listing, and leaves updated_at alone', async () => {
  enqueue([{ availability_confirmed_at: NOW }]);
  const result = await confirmListingAvailable(33, '12');
  assert.deepEqual(result, { ok: true, confirmedAt: NOW.toISOString() });
  const { sql, values } = calls[0];
  assert.ok(sql.startsWith('UPDATE properties p SET availability_confirmed_at = NOW()'));
  assert.ok(sql.includes('p.id = $1 AND p.agent_id = $2'));
  assert.ok(sql.includes(LIVE_LISTING_SQL));
  assert.ok(!sql.includes('updated_at'), 'a confirmation is not an edit');
  assert.deepEqual(values, [12, 33]);
});

test('confirming someone else\'s (or a closed) listing updates nothing and says not_found', async () => {
  enqueue([]);
  assert.deepEqual(await confirmListingAvailable(33, 12), { ok: false, reason: 'not_found' });
  assert.deepEqual(await confirmListingAvailable(33, 'x'), { ok: false, reason: 'not_found' });
  failNextQuery('42703');
  assert.deepEqual(await confirmListingAvailable(33, 12), { ok: false, reason: 'unavailable' });
});

test('the badge shows only a real confirmation up to 30 days old', () => {
  assert.equal(BADGE_MAX_AGE_DAYS, 30);
  assert.equal(badgeConfirmationDate(null, NOW), null);
  assert.equal(badgeConfirmationDate('not a date', NOW), null);
  const fresh = new Date(NOW.getTime() - 2 * DAY);
  assert.equal(badgeConfirmationDate(fresh.toISOString(), NOW)?.getTime(), fresh.getTime());
  assert.ok(badgeConfirmationDate(new Date(NOW.getTime() - 30 * DAY), NOW), 'day 30 still shows');
  assert.equal(badgeConfirmationDate(new Date(NOW.getTime() - 30 * DAY - 1000), NOW), null, 'stale → nothing');
  assert.equal(badgeConfirmationDate(new Date(NOW.getTime() + 2 * DAY), NOW), null, 'a future date is a bad value');
  // jsonb renders timestamptz like this — the shape getListingById hands over.
  assert.ok(badgeConfirmationDate('2026-09-20T08:15:00.123+00:00', NOW));
});

test('the badge date is the Kinshasa calendar day, short month', () => {
  // 23:30 UTC on the 20th is already the 21st in Kinshasa (UTC+1).
  const late = new Date('2026-09-20T23:30:00Z');
  assert.equal(formatConfirmationDate(late, 'fr'), '21 sept.');
  assert.match(formatConfirmationDate(late, 'en'), /^21 Sept?$/);
  assert.equal(formatConfirmationDate(late, 'xx'), '21 sept.');
});

test('daysBetween floors and never goes negative', () => {
  assert.equal(daysBetween(new Date(NOW.getTime() - 7.9 * DAY), NOW), 7);
  assert.equal(daysBetween(new Date(NOW.getTime() + DAY), NOW), 0);
  assert.equal(daysBetween('nope', NOW), null);
});

test('the public detail query reads the column through to_jsonb, so it cannot 42703', async () => {
  enqueue([]);
  await getListingById(123);
  const { sql } = calls[0];
  assert.ok(sql.includes("(to_jsonb(p) ->> 'availability_confirmed_at') AS availability_confirmed_at"));
  assert.ok(!/p\.availability_confirmed_at/.test(sql), 'a plain column reference 500s before the migration');
  assert.ok(sql.includes('p.status = 1 AND p.approve_status = 1'));
});

test('"Loué / vendu" reuses the only path to closed, and "Prix modifié" reuses the price path', () => {
  const prompt = readFileSync(path.join(root, 'components/AgentAvailabilityPrompt.js'), 'utf8');
  assert.ok(prompt.includes("import MarkListingSoldDialog from './MarkListingSoldDialog'"));
  assert.ok(!/listing_status/.test(prompt), 'no new status vocabulary in the prompt');
  const actions = readFileSync(path.join(root, 'app/compte/agent/availabilityActions.js'), 'utf8');
  assert.ok(actions.includes('await updateListingPriceAction(propertyId, formData)'));
  // The stamp happens only after the price write succeeded.
  const priceAction = actions.slice(actions.indexOf('export async function confirmListingPriceChangedAction'));
  assert.ok(
    priceAction.indexOf('if (!priced?.ok) return priced;') < priceAction.indexOf('confirmListingAvailable(agentId, propertyId)'),
  );
  assert.ok(actions.includes("revalidatePath(`/listings/${propertyId}`)"), 'the public badge must refresh after a confirm');
});

test('the migration is additive, idempotent and does not backfill', () => {
  const sql = readFileSync(path.join(root, '..', 'migrations', '20260922_listing_availability.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS availability_confirmed_at timestamptz/);
  assert.ok(!/UPDATE\s+properties/i.test(sql), 'nobody confirmed anything — no backfill');
});
