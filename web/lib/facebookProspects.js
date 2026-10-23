import 'server-only';
import { getPool } from './db';
import { BUSINESS_NUMBERS } from './adminAgentCreate';
import { phoneDigits } from './facebookLeadParser';

/**
 * Facebook group prospects (engine migrations/20261023_facebook_prospects.sql):
 * brokers' numbers found in property posts, to invite as agents. Not `leads`
 * — those are customer requests, see the migration's header.
 *
 * A number is skipped when it is one of ours, or already an agent account
 * (any account, deleted or not: whoever runs the invitations should not
 * re-invite someone the console removed). agents.phone holds every shape
 * agents typed, so its digits are folded the way findDuplicateAgents does
 * (lib/agents.js) before comparing.
 */

const EXCERPT_MAX = 1000;
const TEXT_MAX = 300;

export const KNOWN_AGENT_PHONES_SQL = `
  SELECT DISTINCT
         CASE
           WHEN d ~ '^243[0-9]{9}$'  THEN d
           WHEN d ~ '^0[0-9]{9}$'    THEN '243' || substring(d from 2)
           WHEN d ~ '^[89][0-9]{8}$' THEN '243' || d
           ELSE d
         END AS phone
    FROM (SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS d
            FROM agents
           WHERE phone IS NOT NULL AND phone <> '') a
   WHERE CASE
           WHEN d ~ '^243[0-9]{9}$'  THEN d
           WHEN d ~ '^0[0-9]{9}$'    THEN '243' || substring(d from 2)
           WHEN d ~ '^[89][0-9]{8}$' THEN '243' || d
           ELSE d
         END = ANY($1::text[])`;

// xmax = 0 only on a freshly inserted row, so one statement says new vs seen.
export const UPSERT_PROSPECT_SQL = `
  INSERT INTO facebook_prospects (phone, author_name, group_name, post_url, post_excerpt)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (phone) DO UPDATE
     SET seen_count = facebook_prospects.seen_count + 1,
         last_seen_at = NOW()
  RETURNING id, (xmax = 0) AS inserted`;

export const RECENT_PROSPECTS_SQL = `
  SELECT id, phone, author_name, group_name, post_url, status, seen_count, created_at,
         COUNT(*) FILTER (WHERE status = 'pending_invite') OVER () AS pending_total
    FROM facebook_prospects
   ORDER BY created_at DESC, id DESC
   LIMIT $1`;

/**
 * The newest prospects, for the paste page. Never throws: before the
 * migration (42P01) it answers `available: false`.
 *
 * @returns {Promise<{ available: boolean, pendingTotal: number, rows: object[] }>}
 */
export async function listRecentFacebookProspects(limit = 15) {
  try {
    const { rows } = await getPool().query(RECENT_PROSPECTS_SQL, [limit]);
    // The window count rides on every row; an empty table has none to carry it.
    return { available: true, pendingTotal: Number(rows[0]?.pending_total ?? 0), rows };
  } catch (err) {
    if (err?.code !== '42P01') console.error(`[facebook-prospects] list failed: ${err.message}`);
    return { available: false, pendingTotal: 0, rows: [] };
  }
}

function clip(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

/**
 * Store the numbers found in one post.
 *
 * @param {{ phones: string[], authorName?: string, groupName?: string, postUrl?: string|null, postText?: string }} post
 *   phones as `+243XXXXXXXXX` (extractCongoPhones).
 * @returns {Promise<{ created: string[], skipped: Array<{ phone: string, reason: 'ours'|'agent'|'already_prospect' }> }>}
 */
export async function recordFacebookProspects({ phones, authorName, groupName, postUrl, postText }) {
  const created = [];
  const skipped = [];
  const ours = new Set(BUSINESS_NUMBERS);
  const candidates = [];
  for (const phone of phones) {
    if (ours.has(phoneDigits(phone))) skipped.push({ phone, reason: 'ours' });
    else candidates.push(phone);
  }
  if (!candidates.length) return { created, skipped };

  const pool = getPool();
  const { rows } = await pool.query(KNOWN_AGENT_PHONES_SQL, [candidates.map(phoneDigits)]);
  const agentPhones = new Set(rows.map((r) => r.phone));

  const values = [clip(authorName, TEXT_MAX), clip(groupName, TEXT_MAX), postUrl || null, clip(postText, EXCERPT_MAX)];
  for (const phone of candidates) {
    if (agentPhones.has(phoneDigits(phone))) {
      skipped.push({ phone, reason: 'agent' });
      continue;
    }
    const { rows: [row] } = await pool.query(UPSERT_PROSPECT_SQL, [phoneDigits(phone), ...values]);
    if (row?.inserted) created.push(phone);
    else skipped.push({ phone, reason: 'already_prospect' });
  }
  return { created, skipped };
}
