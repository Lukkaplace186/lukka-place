import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPool } from './db';
import { SITE_URL } from './constants';

/**
 * The landlord's live report link — `/rapport/<id>-<signature>`
 * (migrations/20260929_property_report_links.sql).
 *
 * The agent creates it once and forwards it; the page it opens always shows
 * the current numbers (app/(site)/rapport/[token]/page.js). One active link
 * per listing; "nouveau lien" revokes the old one, which is how an agent cuts
 * off an owner who should no longer see it.
 *
 * THE SIGNATURE, NOT A STORED TOKEN
 * `signature = HMAC-SHA256(secret, "report:<id>:<property_id>:<nonce>")`,
 * base64url, 32 characters. The row holds only the nonce, so a copy of the
 * table opens nothing, and the agent can be shown their link again at any
 * time — it is recomputed, never looked up. Compared in constant time.
 *
 * The secret is REPORT_LINK_SECRET, falling back to AGENT_SESSION_SECRET (with
 * the "report:" prefix keeping the two uses apart). Neither set means the
 * feature is off, never a link signed with an empty key.
 *
 * A missing table (migration not run) is `{ ok: false, reason: 'unavailable' }`
 * on writes and "no link" on reads.
 */

const SIGNATURE_LENGTH = 32;
const MISSING = new Set(['42P01', '42703']);

function secret() {
  return process.env.REPORT_LINK_SECRET || process.env.AGENT_SESSION_SECRET || null;
}

export function reportLinksEnabled() {
  return Boolean(secret());
}

/** The signature for one link row. Throws when no secret is configured. */
export function signReportLink({ id, propertyId, nonce }) {
  const key = secret();
  if (!key) throw new Error('report links need REPORT_LINK_SECRET (or AGENT_SESSION_SECRET)');
  return createHmac('sha256', key)
    .update(`report:${Number(id)}:${Number(propertyId)}:${nonce}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function reportToken(row) {
  return `${Number(row.id)}-${signReportLink({ id: row.id, propertyId: row.property_id, nonce: row.nonce })}`;
}

export function reportUrl(row) {
  return `${SITE_URL}/rapport/${reportToken(row)}`;
}

/** `"12-AbC…"` -> { id: 12, signature: 'AbC…' }, or null for anything else. */
export function parseReportToken(token) {
  const match = /^(\d{1,18})-([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!match) return null;
  return { id: Number(match[1]), signature: match[2] };
}

function sameSignature(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function toLink(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    propertyId: Number(row.property_id),
    url: reportUrl(row),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    lastViewedAt: row.last_viewed_at ? new Date(row.last_viewed_at).toISOString() : null,
    viewCount: Number(row.view_count) || 0,
  };
}

const ACTIVE_LINK_SQL = `
  SELECT l.id, l.property_id, l.nonce, l.created_at, l.last_viewed_at, l.view_count
    FROM property_report_links l
    JOIN properties p ON p.id = l.property_id
   WHERE l.property_id = $1 AND p.agent_id = $2 AND l.revoked_at IS NULL
`;

/** The agent's active link for one of their own listings, or null. */
export async function getActiveReportLink(agentId, propertyId) {
  if (!reportLinksEnabled()) return null;
  try {
    const { rows } = await getPool().query(ACTIVE_LINK_SQL, [Number(propertyId), Number(agentId)]);
    return toLink(rows[0]);
  } catch (err) {
    if (MISSING.has(err?.code)) return null;
    throw err;
  }
}

// Ownership is in the INSERT: a listing that is not the agent's inserts nothing.
export const CREATE_LINK_SQL = `
  INSERT INTO property_report_links (property_id, agent_id, nonce)
  SELECT p.id, p.agent_id, $3 FROM properties p WHERE p.id = $1 AND p.agent_id = $2
  ON CONFLICT (property_id) WHERE revoked_at IS NULL DO NOTHING
  RETURNING id, property_id, nonce, created_at, last_viewed_at, view_count
`;

export const REVOKE_LINK_SQL = `
  UPDATE property_report_links l SET revoked_at = NOW()
    FROM properties p
   WHERE l.property_id = p.id AND l.property_id = $1 AND p.agent_id = $2 AND l.revoked_at IS NULL
`;

/**
 * Create the listing's link, or return the one that already exists.
 * `{ fresh: true }` revokes any active link first ("nouveau lien").
 *
 * @returns {Promise<{ok: true, link: object} | {ok: false, reason: 'unavailable'|'not_found'}>}
 */
export async function createReportLink(agentId, propertyId, { fresh = false } = {}) {
  if (!reportLinksEnabled()) return { ok: false, reason: 'unavailable' };
  const pid = Number(propertyId);
  const aid = Number(agentId);
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(aid)) return { ok: false, reason: 'not_found' };
  const pool = getPool();
  try {
    if (fresh) await pool.query(REVOKE_LINK_SQL, [pid, aid]);
    const { rows } = await pool.query(CREATE_LINK_SQL, [pid, aid, randomBytes(18).toString('base64url')]);
    if (rows.length) return { ok: true, link: toLink(rows[0]) };
    // Nothing inserted: either a link already exists (a second tab, a double
    // tap) or the listing is not theirs.
    const existing = await getActiveReportLink(aid, pid);
    return existing ? { ok: true, link: existing } : { ok: false, reason: 'not_found' };
  } catch (err) {
    if (MISSING.has(err?.code)) return { ok: false, reason: 'unavailable' };
    throw err;
  }
}

/** @returns {Promise<boolean>} whether a link was switched off. */
export async function revokeReportLink(agentId, propertyId) {
  try {
    const { rowCount } = await getPool().query(REVOKE_LINK_SQL, [Number(propertyId), Number(agentId)]);
    return rowCount > 0;
  } catch (err) {
    if (MISSING.has(err?.code)) return false;
    throw err;
  }
}

/**
 * The link behind a public URL, or null — unknown id, wrong signature,
 * revoked, or feature off all look the same to the visitor (a 404).
 */
export async function resolveReportToken(token) {
  const parsed = parseReportToken(token);
  if (!parsed || !reportLinksEnabled()) return null;
  try {
    const { rows } = await getPool().query(
      `SELECT id, property_id, agent_id, nonce, created_at, last_viewed_at, view_count
         FROM property_report_links WHERE id = $1 AND revoked_at IS NULL`,
      [parsed.id],
    );
    const row = rows[0];
    if (!row) return null;
    const expected = signReportLink({ id: row.id, propertyId: row.property_id, nonce: row.nonce });
    if (!sameSignature(expected, parsed.signature)) return null;
    return { ...toLink(row), agentId: row.agent_id == null ? null : Number(row.agent_id) };
  } catch (err) {
    if (MISSING.has(err?.code)) return null;
    throw err;
  }
}

/** Counts an opening of the report — never the listing's own agent's. */
export async function recordReportView(linkId) {
  try {
    await getPool().query(
      'UPDATE property_report_links SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
      [Number(linkId)],
    );
  } catch (err) {
    console.error(`[report-link] view of #${linkId} not counted: ${err.message}`);
  }
}
