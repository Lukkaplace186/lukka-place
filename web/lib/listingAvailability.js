import { getPool } from '@/lib/db';
import { LISTING_TIME_ZONE } from '@/lib/listingView';

/**
 * "Toujours disponible ?" — the weekly availability check, and the public
 * "Disponibilité confirmée le …" badge it earns.
 *
 * In Kinshasa a listing that has sat unchanged for a month reads as a scam,
 * and 32 of 48 live listings were over two weeks old with nothing to say
 * anyone had looked at them. `properties.availability_confirmed_at`
 * (migrations/20260922_listing_availability.sql) records the last time the
 * listing's own agent said "still available". NULL = never; nothing was
 * backfilled, because nobody had confirmed anything.
 *
 * The column may not exist yet (web can deploy before the migration). Every
 * read here catches 42703 and answers "nothing to show", and the public page
 * reads it through to_jsonb(p) in lib/listings.js so it can never 500.
 */

/** A listing is due for a check this long after its last confirmation (or edit). */
export const CONFIRM_AFTER_DAYS = 7;

/** The public badge is shown only while the confirmation is this fresh. */
export const BADGE_MAX_AGE_DAYS = 30;

const DAY_MS = 86_400_000;

// Must match lib/listings.js — property_contents' French row.
const CONTENT_LANGUAGE_ID = 20;

/**
 * "Live" = what a visitor can actually see AND is still on the market:
 * the public gate (status = 1 AND approve_status = 1, web/CLAUDE.md) plus
 * listing_status 'active'. An under-offer listing is deliberately not asked:
 * the agent already told us it is not simply available, and "Toujours
 * disponible ?" would invite them to say it is. NULL listing_status is a
 * legacy row that predates the column, i.e. active.
 */
export const LIVE_LISTING_SQL =
  "p.status = 1 AND p.approve_status = 1 AND COALESCE(p.listing_status, 'active') = 'active'";

/**
 * When the clock for "is this stale?" started: the last confirmation, or —
 * never confirmed — the last time the row changed (updated_at, falling back
 * to created_at). An agent who edited the listing yesterday has looked at it;
 * one who published it in August and never came back has not.
 */
const BASELINE_SQL = 'COALESCE(p.availability_confirmed_at, GREATEST(p.created_at, p.updated_at), p.created_at)';

function isMissingColumn(err) {
  return err?.code === '42703' || err?.code === '42P01';
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Whole days between an instant and `now`, never negative. */
export function daysBetween(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

async function queryDueListings(agentId, { limit = 20, propertyId = null } = {}) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) return [];
  const cap = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
  const values = [id, CONFIRM_AFTER_DAYS, cap];
  let propertyFilter = '';
  if (propertyId != null) {
    const pid = Number.parseInt(propertyId, 10);
    if (!Number.isFinite(pid)) return [];
    values.push(pid);
    propertyFilter = 'AND p.id = $4';
  }

  try {
    const { rows } = await getPool().query(
      `SELECT p.id, pc.title, p.purpose, p.price, p.price_original, p.currency,
              p.availability_confirmed_at, ${BASELINE_SQL} AS baseline_at
       FROM properties p
       LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
       WHERE p.agent_id = $1 AND ${LIVE_LISTING_SQL}
         AND ${BASELINE_SQL} < NOW() - make_interval(days => $2)
         ${propertyFilter}
       ORDER BY ${BASELINE_SQL} ASC, p.id ASC
       LIMIT $3`,
      values,
    );
    return rows;
  } catch (err) {
    // Before the migration: no prompts. Showing them would offer a
    // "Toujours disponible" button whose write is guaranteed to fail.
    if (isMissingColumn(err)) return [];
    throw err;
  }
}

/**
 * The agent's listings that are due for an availability check, stalest first.
 *
 * CONTRACT (consumed by the dashboard to-do list — keep the shape):
 *   [{ id, title, lastConfirmedAt, daysSince }]
 *   - `lastConfirmedAt`: ISO string of the real last confirmation, or null if
 *     the listing was never confirmed. Never a stand-in date.
 *   - `daysSince`: whole days since the last confirmation, or — never
 *     confirmed — since the listing last changed. Always ≥ CONFIRM_AFTER_DAYS.
 *
 * @param {number} agentId
 * @param {{limit?: number, now?: Date}} [options]
 */
export async function getListingsNeedingConfirmation(agentId, { limit = 20, now = new Date() } = {}) {
  const rows = await queryDueListings(agentId, { limit });
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title || null,
    lastConfirmedAt: toIso(row.availability_confirmed_at),
    daysSince: daysBetween(row.baseline_at, now),
  }));
}

/**
 * Same set, with what the prompt card needs to act on a row: the purpose
 * (for "loué" vs "vendu" and MarkListingSoldDialog) and the agent's own
 * authored price, so "Prix modifié" opens pre-filled in their currency.
 *
 * `propertyId` narrows it to one listing — the prompt on that listing's own
 * editor page — and returns [] when that listing is not due.
 */
export async function getAvailabilityPrompts(agentId, { limit = 20, propertyId = null, now = new Date() } = {}) {
  const rows = await queryDueListings(agentId, { limit, propertyId });
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title || null,
    lastConfirmedAt: toIso(row.availability_confirmed_at),
    daysSince: daysBetween(row.baseline_at, now),
    purpose: row.purpose || null,
    currency: String(row.currency || 'USD').toUpperCase() === 'CDF' ? 'CDF' : 'USD',
    // price_original is the figure the agent typed (in `currency`); `price`
    // is canonical USD. Older rows have no price_original.
    authoredPrice: row.price_original != null ? Number(row.price_original) : row.price != null ? Number(row.price) : null,
  }));
}

/**
 * "Toujours disponible": stamp NOW on one of the agent's own live listings.
 *
 * Ownership and liveness are in the WHERE clause, like every other listing
 * write on the dashboard (`AND agent_id = $n`): a guessed id, another
 * agency's listing, a pending or closed one, all update zero rows.
 * `updated_at` is left alone on purpose — confirming is not an edit, and
 * lib/dataExport.js and the engine both read updated_at as "the row changed".
 *
 * @returns {Promise<{ok: true, confirmedAt: string} | {ok: false, reason: 'not_found'|'unavailable'}>}
 */
export async function confirmListingAvailable(agentId, propertyId) {
  const aid = Number.parseInt(agentId, 10);
  const pid = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(aid) || !Number.isFinite(pid)) return { ok: false, reason: 'not_found' };
  try {
    const { rows } = await getPool().query(
      `UPDATE properties p SET availability_confirmed_at = NOW()
       WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_LISTING_SQL}
       RETURNING p.availability_confirmed_at`,
      [pid, aid],
    );
    if (!rows.length) return { ok: false, reason: 'not_found' };
    return { ok: true, confirmedAt: toIso(rows[0].availability_confirmed_at) };
  } catch (err) {
    if (isMissingColumn(err)) return { ok: false, reason: 'unavailable' };
    throw err;
  }
}

/**
 * The confirmation date a public page may print, or null.
 *
 * Only a real stamp no older than BADGE_MAX_AGE_DAYS. A stale confirmation is
 * not shown at all (never "non confirmé"; an absent badge says nothing, which
 * is exactly what we know). A date more than a day in the future is a bad
 * value, not a confirmation, and is refused too.
 *
 * @param {string|Date|null} confirmedAt
 * @returns {Date|null}
 */
export function badgeConfirmationDate(confirmedAt, now = new Date()) {
  if (!confirmedAt) return null;
  const date = confirmedAt instanceof Date ? confirmedAt : new Date(confirmedAt);
  if (Number.isNaN(date.getTime())) return null;
  const ageMs = now.getTime() - date.getTime();
  if (ageMs < -DAY_MS) return null;
  if (ageMs > BADGE_MAX_AGE_DAYS * DAY_MS) return null;
  return date;
}

// Kinshasa calendar on server and client alike (lib/listingView.js), so the
// printed day never depends on the VPS's UTC clock.
const SHORT_DATE_FORMATTERS = {
  fr: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: LISTING_TIME_ZONE }),
  en: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: LISTING_TIME_ZONE }),
};

/** "21 sept." / "21 Sept" — the badge's date. */
export function formatConfirmationDate(date, locale = 'fr') {
  return (SHORT_DATE_FORMATTERS[locale] || SHORT_DATE_FORMATTERS.fr).format(date);
}
