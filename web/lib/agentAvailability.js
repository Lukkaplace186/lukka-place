import 'server-only';
import { getPool } from './db';
import { kinshasaDayKey } from './visitAgenda';
import { normaliseAvailability } from './visitSlots';

/**
 * The days an agent takes no visits (2026-10-10): weekdays off and single
 * dates, set on their agenda page and read by the public visit calendar
 * (components/VisitSlotPicker.js) to grey those days out.
 *
 * `agent_visit_availability`, migrations/20261010_agent_visit_availability.sql
 * (engine repo). One row per agent; no row means "nothing blocked", which is
 * also what every read answers before the migration has run (42P01) or when
 * the query fails — a calendar that refuses to open costs the request, and the
 * agent still confirms every visit themselves.
 *
 * Nothing here is an opening-hours claim. The picker's four slots are the
 * same for every agent; this only removes days.
 */

export const EMPTY_AVAILABILITY = Object.freeze({ closedWeekdays: [], blockedDates: [] });

const DATES_AS_TEXT = "ARRAY(SELECT to_char(d, 'YYYY-MM-DD') FROM unnest(v.blocked_dates) AS d ORDER BY d)";

/**
 * The availability of the agent behind one PUBLIC listing. The public gate is
 * on the listing asked about, like the busy-slot read beside it.
 */
export const LISTING_AVAILABILITY_SQL = `
  SELECT v.closed_weekdays, ${DATES_AS_TEXT} AS blocked_dates
    FROM properties p
    JOIN agent_visit_availability v ON v.agent_id = p.agent_id
   WHERE p.id = $1 AND p.status = 1 AND p.approve_status = 1
   LIMIT 1
`;

const isMissingTable = (err) => err?.code === '42P01' || err?.code === '42703';

function fromRow(row) {
  if (!row) return { ...EMPTY_AVAILABILITY };
  return normaliseAvailability({ closedWeekdays: row.closed_weekdays, blockedDates: row.blocked_dates });
}

/** Never throws: an unreadable setting blocks nothing. */
export async function getListingAvailability(listingId) {
  try {
    const { rows } = await getPool().query(LISTING_AVAILABILITY_SQL, [listingId]);
    return fromRow(rows[0]);
  } catch (err) {
    if (!isMissingTable(err)) console.error(`[agentAvailability] listing #${listingId}: ${err.message}`);
    return { ...EMPTY_AVAILABILITY };
  }
}

/**
 * The agent's own settings, for their agenda page.
 * @returns {Promise<{closedWeekdays: number[], blockedDates: string[], available: boolean}>}
 *   `available: false` before the migration — the card says so instead of
 *   offering a save that would fail.
 */
export async function getAgentAvailability(agentId) {
  try {
    const { rows } = await getPool().query(
      `SELECT v.closed_weekdays, ${DATES_AS_TEXT} AS blocked_dates
         FROM agent_visit_availability v
        WHERE v.agent_id = $1`,
      [agentId],
    );
    return { ...fromRow(rows[0]), available: true };
  } catch (err) {
    if (!isMissingTable(err)) console.error(`[agentAvailability] agent #${agentId}: ${err.message}`);
    return { ...EMPTY_AVAILABILITY, available: !isMissingTable(err) };
  }
}

/**
 * Saves the agent's settings. Dates already gone are dropped (they block
 * nothing any more), and the list is capped so a row cannot grow without bound.
 * @returns {Promise<'saved'|'unavailable'>}
 */
export async function saveAgentAvailability(agentId, input, now = new Date()) {
  const today = kinshasaDayKey(now);
  const { closedWeekdays, blockedDates } = normaliseAvailability(input);
  const dates = blockedDates.filter((d) => d >= today).slice(0, 60);
  try {
    await getPool().query(
      `INSERT INTO agent_visit_availability (agent_id, closed_weekdays, blocked_dates, updated_at)
       VALUES ($1, $2::smallint[], $3::date[], NOW())
       ON CONFLICT (agent_id) DO UPDATE
         SET closed_weekdays = EXCLUDED.closed_weekdays,
             blocked_dates = EXCLUDED.blocked_dates,
             updated_at = NOW()`,
      [agentId, closedWeekdays, dates],
    );
    return 'saved';
  } catch (err) {
    if (isMissingTable(err)) return 'unavailable';
    throw err;
  }
}
