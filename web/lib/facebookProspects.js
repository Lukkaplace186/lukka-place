import 'server-only';
import { getPool } from './db';
import { BUSINESS_NUMBERS } from './adminAgentCreate';
import { phoneDigits } from './facebookLeadParser';
import { UPSERT_PROSPECT_SQL } from './marketProspects';

/**
 * Brokers' numbers found in Facebook group posts (POST /api/ingest/facebook-lead),
 * to invite as agents. Not `leads` — those are customer requests (engine
 * migrations/20261023_facebook_prospects.sql explains why).
 *
 * A number is skipped when it is one of ours, or already an agent account
 * (any account, deleted or not: whoever runs the invitations should not
 * re-invite someone the console removed). agents.phone holds every shape
 * agents typed, so its digits are folded the way findDuplicateAgents does
 * (lib/agents.js) before comparing.
 */

/** market_prospects.name CHECK. */
const NAME_MAX = 120;

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

/**
 * Since 2026-11-08 the numbers land in market_prospects — the ONE agent list
 * "Coller des annonces" fills together with the price guide
 * (migrations/20261108_merge_facebook_prospects.sql moved the older
 * facebook_prospects rows there). Same upsert as the paste: a number already
 * listed keeps the team's name, status and notes, and gains the source.
 * A post read here carries no price, so it adds no advert to the count.
 */
export { UPSERT_PROSPECT_SQL };

function clip(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

/**
 * Store the numbers found in one post.
 *
 * @param {{ phones: string[], authorName?: string, postUrl?: string|null }} post
 *   (groupName and postText are accepted and not stored: the list keeps a
 *   name, the first link and the team's notes, never a post's text.)
 *   phones as `+243XXXXXXXXX` (extractCongoPhones).
 * @returns {Promise<{ created: string[], skipped: Array<{ phone: string, reason: 'ours'|'agent'|'already_prospect' }> }>}
 */
export async function recordFacebookProspects({ phones, authorName, postUrl }) {
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

  const name = clip(authorName, NAME_MAX);
  for (const phone of candidates) {
    if (agentPhones.has(phoneDigits(phone))) {
      skipped.push({ phone, reason: 'agent' });
      continue;
    }
    // (phone, name, agency, sources, first_url, adverts, created_by)
    const { rows: [row] } = await pool.query(UPSERT_PROSPECT_SQL, [phoneDigits(phone), name, null, ['facebook'], postUrl || null, 0, null]);
    if (row?.created) created.push(phone);
    else skipped.push({ phone, reason: 'already_prospect' });
  }
  return { created, skipped };
}
