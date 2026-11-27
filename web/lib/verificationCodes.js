import 'server-only';
import { getPool } from './db';
import { CODE_LOG_KEEP_HOURS, CODE_LOG_SHOW_MINUTES, CODE_VALID_MINUTES, codePurposeKind } from './verificationCodeRules';

/**
 * The codes the website sends, readable by the team on /admin/codes for an
 * hour (owner, 2026-11-24): when a WhatsApp code does not arrive — Chakra
 * confirms no delivery — support reads it out. Table
 * `verification_codes_sent` (migrations/20261124_verification_codes_sent.sql);
 * rules in lib/verificationCodeRules.js.
 */

let tableReady = null; // true once seen; a "no" is re-checked after a minute
let checkedAt = 0;

async function tableExists(pool) {
  if (tableReady === true) return true;
  if (tableReady === false && Date.now() - checkedAt < 60_000) return false;
  const { rows } = await pool.query("SELECT to_regclass('public.verification_codes_sent') IS NOT NULL AS ok");
  tableReady = Boolean(rows[0]?.ok);
  checkedAt = Date.now();
  return tableReady;
}

/**
 * One row per send, from lib/otpDelivery.js. Also deletes rows older than
 * 24 h, so codes in clear never pile up. Never throws: a code that went out
 * must not fail because its copy could not be written.
 *
 * @param {{phone: string, code: string, purpose: string, status: 'sent'|'failed', channel?: string|null, error?: string|null}} row
 */
export async function recordCodeSend({ phone, code, purpose, status, channel = null, error = null }) {
  try {
    const pool = getPool();
    if (!(await tableExists(pool))) return;
    await pool.query(
      `INSERT INTO verification_codes_sent (phone, code, purpose, status, channel, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(phone || '').replace(/\D/g, ''), String(code), String(purpose || 'otp').slice(0, 40), status, channel, error ? String(error).slice(0, 300) : null],
    );
    await pool.query(`DELETE FROM verification_codes_sent WHERE created_at < now() - make_interval(hours => $1)`, [CODE_LOG_KEEP_HOURS]);
  } catch (err) {
    console.error(`[codes] could not record a ${purpose} code for ${phone}: ${err.message}`);
  }
}

/**
 * The last hour's codes, newest first, with the account's name when the
 * number has one (a customer, or a live agent).
 *
 * @returns {Promise<{ready: boolean, rows: object[]}>}
 */
export async function listRecentCodes({ minutes = CODE_LOG_SHOW_MINUTES } = {}) {
  const pool = getPool();
  if (!(await tableExists(pool))) return { ready: false, rows: [] };
  const { rows } = await pool.query(
    `SELECT v.id, v.phone, v.code, v.purpose, v.status, v.channel, v.error, v.created_at,
            (v.created_at > now() - make_interval(mins => $2)) AS within_validity,
            c.full_name AS customer_name,
            NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS agent_person,
            NULLIF(TRIM(a.agency_name), '') AS agent_agency
       FROM verification_codes_sent v
       LEFT JOIN customers c ON c.phone = v.phone
       LEFT JOIN LATERAL (
         SELECT id, agency_name FROM agents
          WHERE phone = v.phone AND deleted_at IS NULL
          ORDER BY id DESC LIMIT 1
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY id LIMIT 1
       ) ai ON true
      WHERE v.created_at > now() - make_interval(mins => $1)
      ORDER BY v.created_at DESC
      LIMIT 200`,
    [minutes, CODE_VALID_MINUTES],
  );
  return {
    ready: true,
    rows: rows.map((r) => {
      const kind = codePurposeKind(r.purpose);
      const name = kind === 'agent'
        ? (r.agent_person || r.agent_agency || null)
        : (r.customer_name || r.agent_person || null);
      return { ...r, kind, name };
    }),
  };
}
