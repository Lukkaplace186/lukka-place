import 'server-only';
import { CONTACT_TAP_CHANNELS, CONTACT_TAP_SURFACES } from './contactTapAttrs';
import { VIEWER_KINDS } from './trackIngest';

/**
 * agent_contact_taps (migrations/20261115_contact_log.sql): a direct
 * "WhatsApp" / "Appeler" tap to an agent that is not on a listing page —
 * profile, directory, project, Espace Client (lib/contactTapAttrs.js).
 *
 * The agent is never taken from the request alone: a project tap is the
 * project's agent (`developments`), a listing-scoped tap (Espace Client) the
 * listing's agent, and an agent id named by the page is only kept when that
 * agent exists and is not deleted. A tap nobody can be attributed to is not
 * stored. Before the migration the table is missing and nothing is stored.
 */
export const RECORD_AGENT_CONTACT_TAP_SQL = `
  INSERT INTO agent_contact_taps (agent_id, channel, surface, listing_id, project_slug, visitor_id, customer_id, viewer_kind, device)
  SELECT a.id, $1::text, $2::text, $3::bigint, $4::text, $5::text, $6::bigint, $7::text, $8::text
    FROM agents a
   WHERE a.id = COALESCE(
           (SELECT d.agent_id FROM developments d WHERE $4::text IS NOT NULL AND LOWER(d.slug) = LOWER($4::text) LIMIT 1),
           (SELECT p.agent_id FROM properties p WHERE $3::bigint IS NOT NULL AND p.id = $3::bigint),
           $9::bigint)
     AND a.deleted_at IS NULL
   LIMIT 1
`;

const MISSING_TABLE = '42P01';

const positive = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** @returns {Promise<boolean>} whether a row was written. */
export async function recordAgentContactTap(pool, {
  surface, channel, agentId = null, listingId = null, projectSlug = null,
  visitorId = null, customerId = null, viewerKind = 'visitor', device = null,
}) {
  if (!CONTACT_TAP_SURFACES.includes(surface) || !CONTACT_TAP_CHANNELS.includes(channel)) return false;
  const slug = typeof projectSlug === 'string' && projectSlug.trim() ? projectSlug.trim().slice(0, 160) : null;
  const listing = positive(listingId);
  const agent = positive(agentId);
  if (!slug && !listing && !agent) return false;
  try {
    const result = await pool.query(RECORD_AGENT_CONTACT_TAP_SQL, [
      channel, surface, listing, slug, visitorId || null, positive(customerId),
      VIEWER_KINDS.includes(viewerKind) ? viewerKind : 'visitor', device || null, agent,
    ]);
    return result.rowCount > 0;
  } catch (err) {
    if (err?.code === MISSING_TABLE) return false;
    throw err;
  }
}
