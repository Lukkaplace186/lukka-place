import 'server-only';
import { cookies } from 'next/headers';
import { getPool } from './db';
import { VISITOR_COOKIE, cleanVisitorId } from './trackIngest';

/**
 * A visitor who taps WhatsApp anonymously and then creates an account (or
 * signs in) in the same browser is the same person: their recent taps join
 * the account, so /admin/contacts shows a name instead of "Anonyme"
 * (2026-11-18, owner: "every contact is anonymous"). Called by signupAction
 * and the customer login, right after the session is set.
 *
 * Only this browser's taps (the `lp_vid` cookie), only the last 24 hours,
 * only taps nobody has claimed: a shared phone's older taps stay anonymous
 * rather than land on whoever signs in next. Agents' and the team's own
 * taps are not visitor taps and are left alone.
 */
export const CLAIM_WINDOW_HOURS = 24;

export const CLAIM_LEAD_CLICKS_SQL = `
  UPDATE whatsapp_clicks SET customer_id = $1::bigint
   WHERE visitor_id = $2::text
     AND customer_id IS NULL
     AND viewer_kind = 'visitor'
     AND created_at > now() - make_interval(hours => ${CLAIM_WINDOW_HOURS})
`;

export const CLAIM_CONTACT_TAPS_SQL = `
  UPDATE agent_contact_taps SET customer_id = $1::bigint
   WHERE visitor_id = $2::text
     AND customer_id IS NULL
     AND viewer_kind = 'visitor'
     AND created_at > now() - make_interval(hours => ${CLAIM_WINDOW_HOURS})
`;

/**
 * @param {number} customerId
 * @param {string|null} [visitorId] defaults to this request's `lp_vid` cookie.
 * @returns {Promise<number>} taps attached. Never throws.
 */
export async function claimRecentContactTaps(customerId, visitorId) {
  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  let visitor = cleanVisitorId(visitorId);
  if (!visitor) {
    try {
      visitor = cleanVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
    } catch {
      visitor = null;
    }
  }
  if (!visitor) return 0;

  const pool = getPool();
  let claimed = 0;
  for (const sql of [CLAIM_LEAD_CLICKS_SQL, CLAIM_CONTACT_TAPS_SQL]) {
    try {
      const result = await pool.query(sql, [id, visitor]);
      claimed += result?.rowCount || 0;
    } catch (err) {
      // 42P01 / 42703: a table or column from migrations/20261115_contact_log.sql
      // is not there yet. Anything else is logged; the sign-in never waits on it.
      if (err?.code !== '42P01' && err?.code !== '42703') {
        console.error(`[contact-tap-claim] customer #${id}: ${err.message}`);
      }
    }
  }
  if (claimed > 0) console.log(`[contact-tap-claim] customer #${id} claimed ${claimed} tap(s) from this browser`);
  return claimed;
}
