import 'server-only';
import { getPool } from './db';
import { costPerAccount, normalisePartnerCode, partnerCodeStems, suggestPartnerCode } from './partnerRules';

/**
 * /admin/partenaires reads and writes: each partner's funnel and the accounts
 * it brought. lib/partners.js stays the narrow storefront half (resolve a
 * code, count a click, credit a signup); this is the console's.
 *
 * THE FUNNEL, per partner, for a period
 *   clicks          partner_clicks rows (one per connection per hour)
 *   visitors        distinct visitor ids among those clicks
 *   viewers         of those visitors, how many opened at least one listing
 *                   AFTER their first click in the period
 *   listing_views   how many listing pages they opened
 *   whatsapp_taps   WhatsApp taps by those visitors after the click
 *   accounts        partner_conversions in the period
 *   verified        of those, accounts whose number is verified
 *
 * Views and taps count people only (viewer_kind visitor or pre-tracking), the
 * same rule as the dashboard. Visit requests are not here: they live in the
 * engine's SQLite under the customer's phone, with no visitor id to follow.
 *
 * Before the migration every read answers `available: false`.
 */

const MISSING = new Set(['42P01', '42703']);

export const PARTNER_FUNNEL_SQL = `
  WITH first_click AS (
    SELECT partner_id, visitor_id, MIN(created_at) AS at
      FROM partner_clicks
     WHERE visitor_id IS NOT NULL AND ($1::int IS NULL OR created_at >= NOW() - make_interval(days => $1::int))
     GROUP BY partner_id, visitor_id
  ),
  clicks AS (
    SELECT partner_id, COUNT(*)::int AS clicks, COUNT(DISTINCT visitor_id)::int AS visitors
      FROM partner_clicks
     WHERE $1::int IS NULL OR created_at >= NOW() - make_interval(days => $1::int)
     GROUP BY partner_id
  ),
  views AS (
    SELECT fc.partner_id, COUNT(DISTINCT pv.visitor_id)::int AS viewers, COUNT(*)::int AS listing_views
      FROM first_click fc
      JOIN page_views pv ON pv.visitor_id = fc.visitor_id AND pv.created_at >= fc.at AND pv.listing_id IS NOT NULL
     WHERE COALESCE(pv.viewer_kind, 'visitor') = 'visitor'
     GROUP BY fc.partner_id
  ),
  taps AS (
    SELECT fc.partner_id, COUNT(*)::int AS whatsapp_taps
      FROM first_click fc
      JOIN whatsapp_clicks w ON w.visitor_id = fc.visitor_id AND w.created_at >= fc.at
     WHERE COALESCE(w.viewer_kind, 'visitor') = 'visitor'
     GROUP BY fc.partner_id
  ),
  conv AS (
    SELECT c.partner_id,
           COUNT(*) FILTER (WHERE $1::int IS NULL OR c.created_at >= NOW() - make_interval(days => $1::int))::int AS accounts,
           COUNT(*) FILTER (WHERE ($1::int IS NULL OR c.created_at >= NOW() - make_interval(days => $1::int)) AND (cu.phone_verified_at IS NOT NULL OR ag.phone_verified_at IS NOT NULL))::int AS verified,
           COUNT(*) FILTER (WHERE cu.phone_verified_at IS NOT NULL OR ag.phone_verified_at IS NOT NULL)::int AS verified_all
      FROM partner_conversions c
      LEFT JOIN customers cu ON c.account_type = 'customer' AND cu.id = c.account_id
      LEFT JOIN agents ag ON c.account_type = 'agent' AND ag.id = c.account_id
     GROUP BY c.partner_id
  )
  SELECT p.id, p.kind, p.code, p.name, p.handle, p.status, p.agent_id, p.notes, p.created_at,
         p.fee_amount, p.fee_currency, p.fee_basis,
         COALESCE(NULLIF(TRIM(a.agency_name), ''), p.name) AS agency_name,
         COALESCE(clicks.clicks, 0) AS clicks,
         COALESCE(clicks.visitors, 0) AS visitors,
         COALESCE(views.viewers, 0) AS viewers,
         COALESCE(views.listing_views, 0) AS listing_views,
         COALESCE(taps.whatsapp_taps, 0) AS whatsapp_taps,
         COALESCE(conv.accounts, 0) AS accounts,
         COALESCE(conv.verified, 0) AS verified,
         COALESCE(conv.verified_all, 0) AS verified_all,
         COUNT(*) OVER () AS total
    FROM partners p
    LEFT JOIN agents a ON a.id = p.agent_id
    LEFT JOIN clicks ON clicks.partner_id = p.id
    LEFT JOIN views ON views.partner_id = p.id
    LEFT JOIN taps ON taps.partner_id = p.id
    LEFT JOIN conv ON conv.partner_id = p.id
   WHERE ($2::text IS NULL OR p.kind = $2)
     AND ($3::bigint IS NULL OR p.id = $3)
     AND ($4::text IS NULL OR p.code ILIKE $4 OR p.name ILIKE $4 OR COALESCE(p.handle, '') ILIKE $4)
   ORDER BY COALESCE(conv.accounts, 0) DESC, COALESCE(clicks.clicks, 0) DESC, p.created_at DESC
   LIMIT $5 OFFSET $6
`;

const likeTerm = (q) => {
  const text = String(q ?? '').trim().slice(0, 80);
  return text ? `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
};

function funnelRow(row) {
  const out = {
    id: Number(row.id),
    kind: row.kind,
    code: row.code,
    name: row.name,
    agencyName: row.agency_name,
    handle: row.handle,
    status: row.status,
    agentId: row.agent_id == null ? null : Number(row.agent_id),
    notes: row.notes,
    createdAt: row.created_at,
    fee: row.fee_amount == null ? null : { amount: Number(row.fee_amount), currency: row.fee_currency, basis: row.fee_basis },
    clicks: Number(row.clicks),
    visitors: Number(row.visitors),
    viewers: Number(row.viewers),
    listingViews: Number(row.listing_views),
    whatsappTaps: Number(row.whatsapp_taps),
    accounts: Number(row.accounts),
    verified: Number(row.verified),
    verifiedAll: Number(row.verified_all),
  };
  out.costPerAccount = costPerAccount(out.fee, out.verifiedAll);
  return out;
}

/**
 * One page of partners with their funnel for the period.
 * `days` null = since the beginning; the cutoff is the database's clock.
 * @param {{kind?: string|null, q?: string|null, days?: number|null, limit?: number, offset?: number}} options
 * @returns {Promise<{available: boolean, rows: object[], total: number}>}
 */
export async function listPartnerFunnels({ kind = null, q = null, days = null, limit = 25, offset = 0 } = {}) {
  try {
    const { rows } = await getPool().query(PARTNER_FUNNEL_SQL, [days, kind, null, likeTerm(q), limit, offset]);
    return { available: true, rows: rows.map(funnelRow), total: rows[0] ? Number(rows[0].total) : 0 };
  } catch (err) {
    if (MISSING.has(err?.code)) return { available: false, rows: [], total: 0 };
    throw err;
  }
}

/** One partner with its funnel, or null. */
export async function getPartnerFunnel(id, { days = null } = {}) {
  const partnerId = Number(id);
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) return null;
  try {
    const { rows } = await getPool().query(PARTNER_FUNNEL_SQL, [days, null, partnerId, null, 1, 0]);
    return rows[0] ? funnelRow(rows[0]) : null;
  } catch (err) {
    if (MISSING.has(err?.code)) return null;
    throw err;
  }
}

/**
 * The accounts a partner brought, newest first, with whether the number is
 * verified and a FACT for review: how many of this partner's accounts share
 * the same connection (ip_hash). Never a verdict.
 */
export const PARTNER_CONVERSIONS_SQL = `
  SELECT c.id, c.account_type, c.account_id, c.via, c.created_at,
         CASE WHEN c.account_type = 'customer' THEN cu.full_name
              ELSE NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') END AS name,
         COALESCE(cu.phone_verified_at, ag.phone_verified_at) AS verified_at,
         CASE WHEN c.ip_hash IS NULL THEN 1
              ELSE COUNT(*) OVER (PARTITION BY c.ip_hash) END AS same_connection,
         COUNT(*) OVER () AS total
    FROM partner_conversions c
    LEFT JOIN customers cu ON c.account_type = 'customer' AND cu.id = c.account_id
    LEFT JOIN agents ag ON c.account_type = 'agent' AND ag.id = c.account_id
    LEFT JOIN LATERAL (
      SELECT first_name, last_name FROM agent_infos WHERE agent_id = ag.id ORDER BY language_id LIMIT 1
    ) ai ON TRUE
   WHERE c.partner_id = $1
   ORDER BY c.created_at DESC
   LIMIT $2 OFFSET $3
`;

export async function listPartnerConversions(partnerId, { limit = 50, offset = 0 } = {}) {
  try {
    const { rows } = await getPool().query(PARTNER_CONVERSIONS_SQL, [partnerId, limit, offset]);
    return {
      rows: rows.map((row) => ({
        id: Number(row.id),
        accountType: row.account_type,
        accountId: Number(row.account_id),
        via: row.via,
        createdAt: row.created_at,
        name: row.name || null,
        verified: Boolean(row.verified_at),
        sameConnection: Number(row.same_connection),
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  } catch (err) {
    if (MISSING.has(err?.code)) return { rows: [], total: 0 };
    throw err;
  }
}

/** Clicks per Kinshasa day for the last `days` days (chart on the partner page). */
export async function getPartnerDailyClicks(partnerId, { days = 30 } = {}) {
  try {
    const { rows } = await getPool().query(
      `SELECT to_char((created_at AT TIME ZONE 'Africa/Kinshasa')::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS clicks
         FROM partner_clicks
        WHERE partner_id = $1 AND created_at >= NOW() - make_interval(days => $2)
        GROUP BY 1 ORDER BY 1`,
      [partnerId, days],
    );
    return rows.map((row) => ({ day: row.day, clicks: Number(row.clicks) }));
  } catch (err) {
    if (MISSING.has(err?.code)) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Writes (partners.manage)
// ---------------------------------------------------------------------------

export class PartnerInputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Creates a creator or a campaign (agents get theirs automatically,
 * lib/partners.js). The code is the one typed, else one made from the name;
 * the database refuses a code a partner or a sales rep already holds.
 *
 * @returns {Promise<{id: number, code: string}>}
 */
export async function createPartner(input) {
  const pool = getPool();
  let code = input.code;
  if (!code) {
    const patterns = partnerCodeStems(input.name).map((stem) => `${stem}__`);
    if (!patterns.length) throw new PartnerInputError('code_needed');
    const taken = await pool.query(
      `SELECT code FROM partners WHERE code LIKE ANY($1::text[])
       UNION SELECT referral_code FROM sales_reps WHERE referral_code LIKE ANY($1::text[])`,
      [patterns],
    );
    code = suggestPartnerCode(input.name, taken.rows.map((r) => r.code));
    if (!code) throw new PartnerInputError('code_needed');
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO partners (kind, code, name, handle, notes, fee_amount, fee_currency, fee_basis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, code`,
      [input.kind, code, input.name, input.handle, input.notes, input.fee?.amount ?? null, input.fee?.currency ?? null, input.fee?.basis ?? null],
    );
    return { id: Number(rows[0].id), code: rows[0].code };
  } catch (err) {
    if (err?.code === '23505') throw new PartnerInputError('code_taken');
    if (MISSING.has(err?.code)) throw new PartnerInputError('unavailable');
    throw err;
  }
}

/**
 * Name, handle, notes, fee and status. The code never changes: it is printed
 * on QR codes and sitting in bios and captions already.
 */
export async function updatePartner(id, input) {
  const { rowCount } = await getPool().query(
    `UPDATE partners
        SET name = $2, handle = $3, notes = $4, fee_amount = $5, fee_currency = $6, fee_basis = $7,
            status = $8, updated_at = NOW()
      WHERE id = $1 AND kind <> 'agent'`,
    [id, input.name, input.handle, input.notes, input.fee?.amount ?? null, input.fee?.currency ?? null, input.fee?.basis ?? null, input.status],
  );
  return rowCount > 0;
}

/** Turns any partner on or off (an agent's too: their links then land untagged). */
export async function setPartnerStatus(id, status) {
  const { rowCount } = await getPool().query(
    'UPDATE partners SET status = $2, updated_at = NOW() WHERE id = $1',
    [id, status === 'inactive' ? 'inactive' : 'active'],
  );
  return rowCount > 0;
}

export { normalisePartnerCode };
