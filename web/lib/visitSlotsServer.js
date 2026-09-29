import 'server-only';

/**
 * Every listing of the agent behind one PUBLIC listing ($1), with that agent's
 * id — the busy-slot read (app/api/listings/[id]/visit-slots). The public gate
 * is on the listing asked about; the agent's other listings are only used as
 * ids to match their confirmed visits, never returned to the browser.
 */
export const APPROVED_AGENT_LISTINGS_SQL = `
  SELECT p2.id, p.agent_id
    FROM properties p
    JOIN properties p2 ON p2.agent_id = p.agent_id
   WHERE p.id = $1 AND p.status = 1 AND p.approve_status = 1 AND p.agent_id IS NOT NULL
   LIMIT 500
`;
