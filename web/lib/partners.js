import 'server-only';
import { getPool } from './db';
import { findRepByReferralCode } from './salesLaunch';
import { normalisePartnerCode, partnerCodeStems, suggestPartnerCode } from './partnerRules';
import { vendorNameSql } from './vendorName';

/**
 * Partner reads and writes (lib/partnerRules.js has the rules and the why).
 * Tables: migrations/20261027_growth_attribution.sql. Before it runs every
 * read answers "no partner" (42P01) and every write records nothing, so links
 * simply carry no code and nobody is blocked from anything.
 */

const MISSING_TABLE = '42P01';
const MISSING = new Set(['42P01', '42703']);
const UNIQUE_VIOLATION = '23505';

const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

function partnerRow(row) {
  return row
    ? {
      id: Number(row.id),
      kind: row.kind,
      code: row.code,
      name: row.name,
      agentId: row.agent_id == null ? null : Number(row.agent_id),
      vendorId: row.vendor_id == null ? null : Number(row.vendor_id),
      agentPhone: row.agent_phone ?? null,
      handle: row.handle ?? null,
      status: row.status,
    }
    : null;
}

/**
 * `partners.vendor_id` (an agency partner's agency) read through to_jsonb so
 * the SQL still parses before migrations/20261116_agency_partner_codes.sql
 * adds the column: NULL until then, and no partner is an agency yet.
 */
export const PARTNER_VENDOR_SQL = `(to_jsonb(p) ->> 'vendor_id')::bigint`;

/**
 * Whether a partner's code counts right now.
 *
 * - An AGENT's code only while the agent campaign is on (cms_settings
 *   growth.referral_campaign, the /admin/campagne switch; no row = off).
 *   Stopped on 2026-11-04: links carrying an agent's code land untagged,
 *   /i/<code> is a 404, signup neither prefills nor credits it.
 * - An AGENCY's code (2026-11-16, JOKER AGENCY) while the agency is marked
 *   partner on its page (partner_agencies) and not deleted. The campaign
 *   switch does not touch it: the partnership is a deal of its own.
 * - Creators' and campaigns' codes are not affected.
 *
 * Same condition in the engine's services/customerOnboarding.js — change one,
 * change the other.
 */
export const AGENT_CODES_LIVE_SQL = `(p.kind NOT IN ('agent', 'agency')
    OR (p.kind = 'agent' AND EXISTS (
      SELECT 1 FROM cms_settings s
       WHERE s.key = 'growth.referral_campaign' AND (s.value ->> 'active') = 'true'))
    OR (p.kind = 'agency' AND EXISTS (
      SELECT 1 FROM partner_agencies pag JOIN vendors pv ON pv.id = pag.vendor_id
       WHERE pag.vendor_id = ${PARTNER_VENDOR_SQL} AND pv.deleted_at IS NULL)))`;

export const FIND_PARTNER_BY_CODE_SQL = `
  SELECT p.id, p.kind, p.code, p.name, p.agent_id, ${PARTNER_VENDOR_SQL} AS vendor_id, p.handle, p.status, a.phone AS agent_phone
  FROM partners p
  LEFT JOIN agents a ON a.id = p.agent_id
  WHERE p.code = $1
    AND (p.agent_id IS NULL OR (a.deleted_at IS NULL AND a.status = 1))
    AND ${AGENT_CODES_LIVE_SQL}
`;

/** An ACTIVE partner by code (an agent partner only while the agent's account is live), or null. */
export async function findActivePartnerByCode(code) {
  const clean = normalisePartnerCode(code);
  if (!clean) return null;
  try {
    const { rows } = await getPool().query(FIND_PARTNER_BY_CODE_SQL, [clean]);
    const partner = partnerRow(rows[0]);
    return partner?.status === 'active' ? partner : null;
  } catch (err) {
    if (err?.code === MISSING_TABLE) return null;
    throw err;
  }
}

/**
 * Whose code this is: a partner's, a sales rep's (whose links keep their own
 * /r/ path), or nobody's.
 *
 * @returns {Promise<{type: 'partner', partner: object}|{type: 'rep', code: string}|null>}
 */
export async function resolveCode(code) {
  const clean = normalisePartnerCode(code);
  if (!clean) return null;
  const partner = await findActivePartnerByCode(clean);
  if (partner) return { type: 'partner', partner };
  const rep = await findRepByReferralCode(clean);
  if (rep && rep.status === 'active') return { type: 'rep', code: rep.referral_code };
  return null;
}

/** A click, at most one per connection per partner per hour. */
export const RECORD_PARTNER_CLICK_SQL = `
  INSERT INTO partner_clicks (partner_id, via, visitor_id, landing_path, ip_hash, user_agent)
  SELECT $1, $2, $3, $4, $5, $6
  WHERE $5::text IS NULL OR NOT EXISTS (
    SELECT 1 FROM partner_clicks c
    WHERE c.partner_id = $1 AND c.ip_hash = $5 AND c.created_at > NOW() - INTERVAL '1 hour'
  )
`;

/** @returns {Promise<boolean>} recorded */
export async function recordPartnerClick({ partnerId, via, visitorId = null, landingPath = null, ipHash = null, userAgent = null }) {
  try {
    const { rowCount } = await getPool().query(RECORD_PARTNER_CLICK_SQL, [
      partnerId,
      ['link', 'qr', 'param'].includes(via) ? via : 'link',
      visitorId || null,
      landingPath ? String(landingPath).slice(0, 1000) : null,
      ipHash || null,
      userAgent ? String(userAgent).slice(0, 300) : null,
    ]);
    return rowCount > 0;
  } catch (err) {
    if (err?.code === MISSING_TABLE) return false;
    throw err;
  }
}

/**
 * Credits the account to the partner whose link brought it. Written once per
 * account (UNIQUE), so the first valid referral wins here too. Refused, and
 * nothing written, when the partner is the agent whose own number this is.
 *
 * @returns {Promise<{recorded: boolean, reason?: string}>}
 */
export async function recordPartnerConversion({
  partner, accountType, accountId, accountPhone = null, via = null, visitorId = null, ipHash = null,
}) {
  if (!partner?.id || !['customer', 'agent'].includes(accountType) || !accountId) return { recorded: false, reason: 'invalid' };
  if (partner.kind === 'agent') {
    if (accountType === 'agent' && Number(accountId) === partner.agentId) return { recorded: false, reason: 'self_referral' };
    const own = digitsOf(partner.agentPhone);
    if (own && own === digitsOf(accountPhone)) return { recorded: false, reason: 'self_referral' };
  }
  try {
    const { rowCount } = await getPool().query(
      `INSERT INTO partner_conversions (partner_id, account_type, account_id, event, via, visitor_id, ip_hash)
       VALUES ($1, $2, $3, 'signup', $4, $5, $6)
       ON CONFLICT (account_type, account_id, event) DO NOTHING`,
      [partner.id, accountType, accountId, via, visitorId || null, ipHash || null],
    );
    return { recorded: rowCount > 0, reason: rowCount > 0 ? undefined : 'already_credited' };
  } catch (err) {
    if (err?.code === MISSING_TABLE) return { recorded: false, reason: 'unavailable' };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Agent codes
// ---------------------------------------------------------------------------

export const AGENT_PARTNER_NAME_SQL = `
  SELECT a.id,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                  NULLIF(TRIM(a.agency_name), '')) AS name
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY language_id LIMIT 1
  ) ai ON TRUE
  WHERE a.id = $1 AND a.deleted_at IS NULL
`;

/**
 * Picks a free code for `name` and inserts the partner with it, picking again
 * when another request took the same code a moment ago. `insert(code)` runs
 * the INSERT … ON CONFLICT DO NOTHING RETURNING code; `reread()` finds the row
 * a concurrent request created for the same agent or agency.
 */
async function insertWithFreshCode(pool, name, fallbackId, insert, reread) {
  const patterns = partnerCodeStems(name, { fallbackId }).map((stem) => `${stem}__`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const taken = await pool.query(
      `SELECT code FROM partners WHERE code LIKE ANY($1::text[])
       UNION SELECT referral_code FROM sales_reps WHERE referral_code LIKE ANY($1::text[])`,
      [patterns],
    );
    const code = suggestPartnerCode(name, taken.rows.map((r) => r.code), { fallbackId });
    if (!code) return null;
    try {
      const inserted = await insert(code);
      if (inserted.rows[0]) return inserted.rows[0].code;
      const again = await reread();
      return again.rows[0]?.code ?? null;
    } catch (err) {
      if (err?.code !== UNIQUE_VIOLATION) throw err;
    }
  }
  return null;
}

/**
 * A partner agency's code (2026-11-16, JOKER AGENCY first): ONE code for the
 * whole agency, so every customer its owner or any of its agents brings
 * counts for the agency and is paid to it as one total. Created the first
 * time it is needed (the agency's console page, one of its agents' links);
 * the stem is the agency's name (JOKER AGENCY → JOKER01). Null when the
 * agency is not marked partner or is deleted, before
 * migrations/20261116_agency_partner_codes.sql, or when the database cannot
 * answer — an agent's links then carry their own code as before.
 *
 * @returns {Promise<string|null>}
 */
export async function ensureAgencyPartnerCode(vendorId) {
  const id = Number(vendorId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const pool = getPool();
  try {
    const existing = await pool.query('SELECT code FROM partners WHERE vendor_id = $1', [id]);
    if (existing.rows[0]) return existing.rows[0].code;

    const { rows } = await pool.query(
      `SELECT ${vendorNameSql('v')} AS name
         FROM vendors v JOIN partner_agencies pag ON pag.vendor_id = v.id
        WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) return null;
    const name = String(rows[0].name || `Agence ${id}`).slice(0, 160);
    return await insertWithFreshCode(
      pool, name, id,
      (code) => pool.query(
        `INSERT INTO partners (kind, code, name, vendor_id) VALUES ('agency', $1, $2, $3)
         ON CONFLICT (vendor_id) WHERE vendor_id IS NOT NULL DO NOTHING
         RETURNING code`,
        [code, name, id],
      ),
      () => pool.query('SELECT code FROM partners WHERE vendor_id = $1', [id]),
    );
  } catch (err) {
    if (!MISSING.has(err?.code)) console.error(`[partners] agency #${id} code failed: ${err.message}`);
    return null;
  }
}

/**
 * The agency's referral partner for its console page: `{ id, code }`, the
 * code created on first view. Null when the agency is not a partner or before
 * the migration.
 */
export async function getAgencyPartner(vendorId) {
  const code = await ensureAgencyPartnerCode(vendorId);
  if (!code) return null;
  const { rows } = await getPool().query('SELECT id FROM partners WHERE code = $1', [code]);
  return rows[0] ? { id: Number(rows[0].id), code } : null;
}

/** The agent's agency when it is a live partner agency (no row otherwise). */
export const AGENT_PARTNER_AGENCY_SQL = `
  SELECT a.vendor_id
    FROM agents a
    JOIN partner_agencies pag ON pag.vendor_id = a.vendor_id
    JOIN vendors v ON v.id = a.vendor_id AND v.deleted_at IS NULL
   WHERE a.id = $1 AND a.deleted_at IS NULL
`;

async function agencyCodeForAgent(agentId) {
  try {
    const { rows } = await getPool().query(AGENT_PARTNER_AGENCY_SQL, [agentId]);
    return rows[0]?.vendor_id ? await ensureAgencyPartnerCode(rows[0].vendor_id) : null;
  } catch (err) {
    if (!MISSING.has(err?.code)) console.error(`[partners] agent #${agentId} agency lookup failed: ${err.message}`);
    return null;
  }
}

/**
 * The code an agent's links carry, created the first time it is needed (a
 * share link, the dashboard card).
 *
 * An agent of a PARTNER AGENCY carries the agency's code
 * (ensureAgencyPartnerCode): the owner and every agent share one code and one
 * total. Everyone else has their own: the stem is their first name, else
 * their agency's name, else `LP` + their id in letters. Null before the
 * migration, for a deleted agent, or when the database is unreachable — a
 * share link then simply carries no code.
 *
 * @returns {Promise<string|null>}
 */
export async function ensureAgentPartnerCode(agentId) {
  const id = Number(agentId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const agencyCode = await agencyCodeForAgent(id);
  if (agencyCode) return agencyCode;
  const pool = getPool();
  try {
    const existing = await pool.query('SELECT code FROM partners WHERE agent_id = $1', [id]);
    if (existing.rows[0]) return existing.rows[0].code;

    const { rows } = await pool.query(AGENT_PARTNER_NAME_SQL, [id]);
    if (!rows[0]) return null;
    const name = rows[0].name || null;
    return await insertWithFreshCode(
      pool, name, id,
      (code) => pool.query(
        `INSERT INTO partners (kind, code, name, agent_id) VALUES ('agent', $1, $2, $3)
         ON CONFLICT (agent_id) WHERE agent_id IS NOT NULL DO NOTHING
         RETURNING code`,
        [code, String(name || `Agent ${id}`).slice(0, 160), id],
      ),
      () => pool.query('SELECT code FROM partners WHERE agent_id = $1', [id]),
    );
  } catch (err) {
    if (err?.code !== MISSING_TABLE) console.error(`[partners] agent #${id} code failed: ${err.message}`);
    return null;
  }
}

/** What one code has brought; `$1` is the code (the agent's own, or their agency's). */
export const AGENT_REFERRAL_STATS_SQL = `
  SELECT p.kind, p.name,
    (SELECT COUNT(*) FROM partner_clicks WHERE partner_id = p.id)::int AS clicks,
    (SELECT COUNT(*) FROM partner_clicks WHERE partner_id = p.id AND created_at >= NOW() - INTERVAL '30 days')::int AS clicks_30d,
    (SELECT COUNT(*) FROM partner_conversions c WHERE c.partner_id = p.id AND c.account_type = 'customer')::int AS accounts,
    (SELECT COUNT(*) FROM partner_conversions c JOIN customers cu ON cu.id = c.account_id
      WHERE c.partner_id = p.id AND c.account_type = 'customer' AND cu.phone_verified_at IS NOT NULL)::int AS verified
  FROM partners p
  WHERE p.code = $1
`;

/**
 * The agent dashboard's "Mes parrainages" card: their code (created if
 * missing) and what it has brought — clicks on their links, customer
 * accounts, and how many of those verified their number. For an agent of a
 * partner agency these are the AGENCY's figures (`scope: 'agency'`, with its
 * name): everything its people brought, together.
 *
 * @returns {Promise<{code: string, scope: 'agent'|'agency', agencyName: string|null,
 *                    clicks: number, clicks30d: number, accounts: number, verified: number}|null>}
 *   null before the migration or when the database is unreachable.
 */
export async function getAgentReferralStats(agentId) {
  const code = await ensureAgentPartnerCode(agentId);
  if (!code) return null;
  try {
    const { rows } = await getPool().query(AGENT_REFERRAL_STATS_SQL, [code]);
    const row = rows[0] || {};
    const scope = row.kind === 'agency' ? 'agency' : 'agent';
    return {
      code,
      scope,
      agencyName: scope === 'agency' ? row.name || null : null,
      clicks: Number(row.clicks || 0),
      clicks30d: Number(row.clicks_30d || 0),
      accounts: Number(row.accounts || 0),
      verified: Number(row.verified || 0),
    };
  } catch (err) {
    if (err?.code !== MISSING_TABLE) console.error(`[partners] agent #${agentId} stats failed: ${err.message}`);
    return null;
  }
}
