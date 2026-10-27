import 'server-only';
import { getPool } from './db';
import { findRepByReferralCode } from './salesLaunch';
import { normalisePartnerCode, partnerCodeStems, suggestPartnerCode } from './partnerRules';

/**
 * Partner reads and writes (lib/partnerRules.js has the rules and the why).
 * Tables: migrations/20261027_growth_attribution.sql. Before it runs every
 * read answers "no partner" (42P01) and every write records nothing, so links
 * simply carry no code and nobody is blocked from anything.
 */

const MISSING_TABLE = '42P01';
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
      agentPhone: row.agent_phone ?? null,
      handle: row.handle ?? null,
      status: row.status,
    }
    : null;
}

export const FIND_PARTNER_BY_CODE_SQL = `
  SELECT p.id, p.kind, p.code, p.name, p.agent_id, p.handle, p.status, a.phone AS agent_phone
  FROM partners p
  LEFT JOIN agents a ON a.id = p.agent_id
  WHERE p.code = $1
    AND (p.agent_id IS NULL OR (a.deleted_at IS NULL AND a.status = 1))
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
 * The agent's own partner code, created the first time it is needed (a share
 * link, the dashboard card). The stem is their first name, else their agency's
 * name, else `LP` + their id in letters. Null before the migration, for a
 * deleted agent, or when the database is unreachable — a share link then
 * simply carries no code.
 *
 * @returns {Promise<string|null>}
 */
export async function ensureAgentPartnerCode(agentId) {
  const id = Number(agentId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const pool = getPool();
  try {
    const existing = await pool.query('SELECT code FROM partners WHERE agent_id = $1', [id]);
    if (existing.rows[0]) return existing.rows[0].code;

    const { rows } = await pool.query(AGENT_PARTNER_NAME_SQL, [id]);
    if (!rows[0]) return null;
    const name = rows[0].name || null;
    const patterns = partnerCodeStems(name, { fallbackId: id }).map((stem) => `${stem}__`);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const taken = await pool.query(
        `SELECT code FROM partners WHERE code LIKE ANY($1::text[])
         UNION SELECT referral_code FROM sales_reps WHERE referral_code LIKE ANY($1::text[])`,
        [patterns],
      );
      const code = suggestPartnerCode(name, taken.rows.map((r) => r.code), { fallbackId: id });
      if (!code) return null;
      try {
        const inserted = await pool.query(
          `INSERT INTO partners (kind, code, name, agent_id) VALUES ('agent', $1, $2, $3)
           ON CONFLICT (agent_id) WHERE agent_id IS NOT NULL DO NOTHING
           RETURNING code`,
          [code, String(name || `Agent ${id}`).slice(0, 160), id],
        );
        if (inserted.rows[0]) return inserted.rows[0].code;
        const again = await pool.query('SELECT code FROM partners WHERE agent_id = $1', [id]);
        return again.rows[0]?.code ?? null;
      } catch (err) {
        // Another request took the same code a moment ago: pick again.
        if (err?.code !== UNIQUE_VIOLATION) throw err;
      }
    }
    return null;
  } catch (err) {
    if (err?.code !== MISSING_TABLE) console.error(`[partners] agent #${id} code failed: ${err.message}`);
    return null;
  }
}
