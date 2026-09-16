import 'server-only';
import { randomBytes } from 'node:crypto';
import { getPool } from './db';
import { IMPERSONATION_TARGETS, IMPERSONATION_TTL_MS, parseImpersonationToken } from './impersonationToken';

/**
 * "View as" — an admin sees the agent dashboard or the Espace Client exactly
 * as that person does, to support them without asking for their password.
 *
 * The rules, all enforced server-side:
 *   - `accounts.impersonate` (owner, support) and an individual console account:
 *     the shared team password cannot start one, because "who looked at this
 *     customer's account" must have a name.
 *   - A written reason, stored with the session.
 *   - Read-only. middleware.js refuses every non-GET request outside /admin
 *     while the cookie is present (impersonationToken.js). Confirming a visit
 *     from an agent's dashboard WhatsApps a real customer; a change made "as"
 *     someone is indistinguishable afterwards from one they made. Changes go
 *     through the console's own audited actions instead.
 *   - 60 minutes, not renewable. The target session cookie minted for it
 *     expires with it.
 *   - One open session per admin: starting another ends the first.
 *   - An exit, an admin logout, or the admin's own access being reset or
 *     disabled ends it (the admin's token_version is carried in the cookie).
 *
 * Known limit, stated rather than hidden: agent and customer session tokens
 * are stateless, so the target cookie minted here stays cryptographically
 * valid until its own 60-minute expiry even after the session row is ended.
 * Exit deletes it from the browser; nothing else ever holds it.
 */

export const IMPERSONATION_REASON_MIN = 10;
export const IMPERSONATION_REASON_MAX = 500;

const AGENT_TARGET_SQL = `
  SELECT a.id, COALESCE(a.token_version, 0) AS token_version,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), NULLIF(TRIM(a.agency_name), ''), 'Agent #' || a.id) AS label
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id
    ORDER BY (language_id = 20) DESC, language_id LIMIT 1
  ) ai ON true
  WHERE a.id = $1`;

const CUSTOMER_TARGET_SQL = `
  SELECT c.id, COALESCE(c.token_version, 0) AS token_version,
         COALESCE(NULLIF(TRIM(c.full_name), ''), 'Client #' || c.id) AS label
  FROM customers c
  WHERE c.id = $1`;

export function landingPathFor(targetType) {
  return targetType === 'agent' ? '/compte/agent' : '/compte';
}

export function consolePathFor(targetType, targetId) {
  return targetType === 'agent' ? `/admin/agents/${targetId}` : `/admin/customers/${targetId}`;
}

/**
 * @returns {Promise<{errorKey: string} | {session: {id: number, nonce: string, expiresAt: number},
 *   target: {id: number, tokenVersion: number, label: string}, replaced: number}>}
 */
export async function startImpersonation({ adminId, targetType, targetId, reason, ip = null, userAgent = null, now = Date.now() }) {
  if (!IMPERSONATION_TARGETS.includes(targetType)) return { errorKey: 'admin.impersonation.invalidTarget' };
  const id = Number.parseInt(targetId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return { errorKey: 'admin.impersonation.invalidTarget' };
  const text = String(reason || '').trim().replace(/\s+/g, ' ');
  if (text.length < IMPERSONATION_REASON_MIN || text.length > IMPERSONATION_REASON_MAX) {
    return { errorKey: 'admin.impersonation.reasonInvalid' };
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(targetType === 'agent' ? AGENT_TARGET_SQL : CUSTOMER_TARGET_SQL, [id]);
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.impersonation.targetMissing' };
    }
    const replaced = await client.query(
      `UPDATE console_impersonation_sessions SET ended_at = NOW(), end_reason = 'replaced'
       WHERE admin_user_id = $1 AND ended_at IS NULL`,
      [adminId],
    );
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = now + IMPERSONATION_TTL_MS;
    const inserted = await client.query(
      `INSERT INTO console_impersonation_sessions
         (token_nonce, admin_user_id, target_type, target_id, target_label, reason, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))
       RETURNING id`,
      [nonce, adminId, targetType, id, target.rows[0].label, text, ip, userAgent ? String(userAgent).slice(0, 300) : null, expiresAt],
    );
    await client.query('COMMIT');
    return {
      session: { id: Number(inserted.rows[0].id), nonce, expiresAt },
      target: { id, tokenVersion: Number(target.rows[0].token_version), label: target.rows[0].label },
      replaced: replaced.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * End one session. Returns the row (with the admin's name for the audit entry)
 * when THIS call ended it, null when it was already ended or never existed.
 */
export async function endImpersonation({ sessionId, nonce, reason }) {
  const { rows } = await getPool().query(
    `UPDATE console_impersonation_sessions s
     SET ended_at = NOW(), end_reason = $3
     FROM console_admin_users u
     WHERE s.id = $1 AND s.token_nonce = $2 AND s.ended_at IS NULL AND u.id = s.admin_user_id
     RETURNING s.id, s.admin_user_id, s.target_type, s.target_id, s.target_label, s.started_at, s.ended_at,
               u.full_name AS admin_name, u.email AS admin_email`,
    [sessionId, nonce, reason],
  );
  return rows[0] || null;
}

/**
 * The live state behind an impersonation cookie, for the banner.
 * @returns {Promise<null | {active: boolean, row: object}>} null when the cookie is not ours at all.
 */
export async function getImpersonationState(token, { now = Date.now() } = {}) {
  const parsed = parseImpersonationToken(token, { now, allowExpired: true });
  if (!parsed) return null;
  const { rows } = await getPool().query(
    `SELECT s.id, s.target_type, s.target_id, s.target_label, s.reason, s.started_at, s.expires_at, s.ended_at,
            u.status AS admin_status, u.token_version AS admin_token_version, u.full_name AS admin_name
     FROM console_impersonation_sessions s
     JOIN console_admin_users u ON u.id = s.admin_user_id
     WHERE s.id = $1 AND s.token_nonce = $2`,
    [parsed.sessionId, parsed.nonce],
  );
  const row = rows[0];
  if (!row) return { active: false, row: { target_type: parsed.targetType, target_id: parsed.targetId, target_label: null, expires_at: new Date(parsed.expiresAt) } };
  const active = !parsed.expired
    && !row.ended_at
    && new Date(row.expires_at).getTime() > now
    && row.admin_status === 'active'
    && Number(row.admin_token_version) === parsed.adminTokenVersion;
  return { active, row };
}

export async function listImpersonationSessions({ adminUserId, targetType, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (adminUserId != null && /^\d+$/.test(String(adminUserId))) {
    params.push(Number(adminUserId));
    where.push(`s.admin_user_id = $${params.length}`);
  }
  if (IMPERSONATION_TARGETS.includes(targetType)) {
    params.push(targetType);
    where.push(`s.target_type = $${params.length}`);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const pageOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM console_impersonation_sessions s ${whereClause}`, params),
    pool.query(
      `SELECT s.id, s.admin_user_id, u.full_name AS admin_name, s.target_type, s.target_id, s.target_label, s.reason,
              s.ip, s.started_at, s.expires_at, s.ended_at, s.end_reason
       FROM console_impersonation_sessions s
       JOIN console_admin_users u ON u.id = s.admin_user_id
       ${whereClause}
       ORDER BY s.started_at DESC, s.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageLimit, pageOffset],
    ),
  ]);
  return { total: count.rows[0]?.total ?? 0, rows: page.rows };
}
