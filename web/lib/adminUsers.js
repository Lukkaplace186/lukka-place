import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';
import { safeEqualHex, scryptHex } from './authCrypto';
import { ADMIN_ROLES } from './adminRoles';

/**
 * Individual Lukka Place team accounts for /admin (`console_admin_users`,
 * migrations/20260914_admin_console_platform.sql).
 *
 * - **No admin ever types someone else's password.** An owner invites a person
 *   by name, email and role; that person receives a single-use activation link
 *   and chooses their own password. Only the SHA-256 of the link's token is
 *   stored, and it is cleared in the same UPDATE that sets the password, so a
 *   replayed link updates zero rows — the same shape as agent activation.
 * - **Lockout is per account AND per IP.** Five wrong passwords lock the account
 *   for 15 minutes; twenty failures from one address in 15 minutes refuse that
 *   address regardless of which email it tries.
 * - **Every reset or disable bumps `token_version`**, which every session token
 *   carries, so access ends everywhere at once — not at the next 12h expiry.
 * - **There is always an owner.** The last active owner cannot be demoted or
 *   disabled, or the team could lock itself out of its own console.
 */

export const ACTIVATION_TTL_MS = 72 * 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_MAX_FAILURES = 20;
export const MIN_PASSWORD_LENGTH = 12;

const USER_FIELDS = `
  u.id, u.email, u.full_name, u.role, u.status, u.token_version, u.failed_login_count,
  u.locked_until, u.last_login_at, u.invited_by, u.created_at, u.updated_at,
  (u.password_hash IS NOT NULL) AS has_password,
  (u.activation_token_hash IS NOT NULL AND u.activation_expires_at > NOW()) AS invite_pending,
  u.activation_expires_at,
  inv.full_name AS invited_by_name
`;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hashAdminPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptHex(String(password), salt)}`;
}

function passwordMatches(candidate, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  return safeEqualHex(scryptHex(String(candidate || ''), salt), expected);
}

// Spent on a login for an unknown email so response time does not reveal
// which addresses have accounts.
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

/** @returns {string|null} an i18n key, or null when the password is acceptable */
export function adminPasswordProblem(password, confirm) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) return 'admin.team.passwordTooShort';
  if (confirm !== undefined && value !== String(confirm || '')) return 'admin.team.passwordMismatch';
  return null;
}

function toUser(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    invited_by: row.invited_by == null ? null : Number(row.invited_by),
  };
}

export async function getAdminUserById(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const { rows } = await getPool().query(
    `SELECT ${USER_FIELDS} FROM console_admin_users u
     LEFT JOIN console_admin_users inv ON inv.id = u.invited_by
     WHERE u.id = $1`,
    [numericId],
  );
  return toUser(rows[0]);
}

export async function listAdminUsers() {
  const { rows } = await getPool().query(
    `SELECT ${USER_FIELDS} FROM console_admin_users u
     LEFT JOIN console_admin_users inv ON inv.id = u.invited_by
     ORDER BY (u.status = 'disabled'), u.role = 'owner' DESC, LOWER(u.full_name)`,
  );
  return rows.map(toUser);
}

export async function countActiveOwners(client = getPool()) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM console_admin_users WHERE role = 'owner' AND status = 'active'",
  );
  return rows[0]?.n ?? 0;
}

/**
 * Invite a team member. Returns the plaintext activation token ONCE, for the
 * inviting owner to send; it cannot be recovered afterwards.
 */
export async function createAdminInvite({ email, fullName, role, invitedBy = null }) {
  const cleanEmail = normalizeEmail(email);
  const name = String(fullName || '').trim().slice(0, 120);
  if (!cleanEmail) return { errorKey: 'admin.team.invalidEmail' };
  if (!name) return { errorKey: 'admin.team.nameRequired' };
  if (!ADMIN_ROLES.includes(role)) return { errorKey: 'admin.team.invalidRole' };

  const token = randomBytes(32).toString('base64url');
  try {
    const { rows } = await getPool().query(
      `INSERT INTO console_admin_users
         (email, full_name, role, status, activation_token_hash, activation_expires_at, invited_by)
       VALUES ($1, $2, $3, 'invited', $4, NOW() + make_interval(secs => $5), $6)
       RETURNING id`,
      [cleanEmail, name, role, sha256(token), ACTIVATION_TTL_MS / 1000, invitedBy],
    );
    return { user: await getAdminUserById(rows[0].id), token };
  } catch (err) {
    if (err.code === '23505') return { errorKey: 'admin.team.emailTaken' };
    throw err;
  }
}

/**
 * A fresh activation link for an existing account — the "forgot password" /
 * "lost the invite" path. Bumps token_version so any session the account
 * already has ends now; the password is replaced only when the link is used.
 */
export async function reissueAdminAccess(id) {
  const token = randomBytes(32).toString('base64url');
  const { rowCount } = await getPool().query(
    `UPDATE console_admin_users
        SET activation_token_hash = $1,
            activation_expires_at = NOW() + make_interval(secs => $2),
            token_version = token_version + 1,
            updated_at = NOW()
      WHERE id = $3 AND status <> 'disabled'`,
    [sha256(token), ACTIVATION_TTL_MS / 1000, id],
  );
  return rowCount > 0 ? { token } : { errorKey: 'admin.team.cannotReissue' };
}

/** What the activation page shows before the password is chosen. */
export async function getInviteByToken(token) {
  if (!token) return null;
  const { rows } = await getPool().query(
    `SELECT id, email, full_name, role, status FROM console_admin_users
     WHERE activation_token_hash = $1 AND activation_expires_at > NOW() AND status <> 'disabled'`,
    [sha256(token)],
  );
  return toUser(rows[0]);
}

/** Redeem an activation link. One UPDATE: a replayed token matches no row. */
export async function activateAdminAccount({ token, password, confirm }) {
  const problem = adminPasswordProblem(password, confirm);
  if (problem) return { errorKey: problem };
  const { rows } = await getPool().query(
    `UPDATE console_admin_users
        SET password_hash = $1, status = 'active', activation_token_hash = NULL,
            activation_expires_at = NULL, failed_login_count = 0, locked_until = NULL,
            token_version = token_version + 1, updated_at = NOW()
      WHERE activation_token_hash = $2 AND activation_expires_at > NOW() AND status <> 'disabled'
      RETURNING id`,
    [hashAdminPassword(password), sha256(token)],
  );
  if (!rows[0]) return { errorKey: 'admin.team.linkExpired' };
  return { user: await getAdminUserById(rows[0].id) };
}

async function recordAttempt(email, ip, succeeded) {
  await getPool()
    .query('INSERT INTO console_admin_login_attempts (email, ip, succeeded) VALUES ($1, $2, $3)', [email, ip, succeeded])
    .catch((err) => console.error(`[admin/login] could not record attempt: ${err.message}`));
}

export async function ipIsThrottled(ip) {
  if (!ip) return false;
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM console_admin_login_attempts
     WHERE ip = $1 AND succeeded = false AND created_at > NOW() - make_interval(secs => $2)`,
    [ip, IP_WINDOW_MS / 1000],
  );
  return (rows[0]?.n ?? 0) >= IP_MAX_FAILURES;
}

/**
 * @returns {Promise<{ok: true, user: object} | {ok: false, reason: 'invalid'|'locked'|'throttled'}>}
 */
export async function authenticateAdmin({ email, password, ip }) {
  const cleanEmail = normalizeEmail(email);
  if (await ipIsThrottled(ip)) {
    await recordAttempt(cleanEmail, ip, false);
    return { ok: false, reason: 'throttled' };
  }

  const pool = getPool();
  const { rows } = cleanEmail
    ? await pool.query(
      `SELECT id, password_hash, status, locked_until, failed_login_count
       FROM console_admin_users WHERE LOWER(email) = $1`,
      [cleanEmail],
    )
    : { rows: [] };
  const row = rows[0];

  if (!row || row.status !== 'active' || !row.password_hash) {
    passwordMatches(password, DUMMY_HASH);
    await recordAttempt(cleanEmail, ip, false);
    return { ok: false, reason: 'invalid' };
  }
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    await recordAttempt(cleanEmail, ip, false);
    return { ok: false, reason: 'locked' };
  }
  if (!passwordMatches(password, row.password_hash)) {
    await pool.query(
      `UPDATE console_admin_users
          SET failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
              locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN NOW() + make_interval(secs => $3) ELSE locked_until END,
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, MAX_FAILED_LOGINS, LOCKOUT_MS / 1000],
    );
    await recordAttempt(cleanEmail, ip, false);
    return { ok: false, reason: 'invalid' };
  }

  await pool.query(
    `UPDATE console_admin_users
        SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [row.id],
  );
  await recordAttempt(cleanEmail, ip, true);
  return { ok: true, user: await getAdminUserById(row.id) };
}

/** The legacy shared-password login uses the same per-IP throttle and log. */
export async function recordSharedPasswordAttempt(ip, succeeded) {
  await recordAttempt('shared-password', ip, succeeded);
}

/**
 * Change a team member's role and/or status. Refuses to leave the console
 * without an active owner; disabling bumps token_version so their sessions end.
 */
export async function updateAdminUser(id, { role, status }) {
  if (role !== undefined && !ADMIN_ROLES.includes(role)) return { errorKey: 'admin.team.invalidRole' };
  if (status !== undefined && !['active', 'disabled'].includes(status)) return { errorKey: 'admin.team.invalidStatus' };

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, role, status, password_hash FROM console_admin_users WHERE id = $1 FOR UPDATE', [id]);
    const current = rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.team.notFound' };
    }
    const nextRole = role ?? current.role;
    // Re-enabling someone who never set a password leaves them invited, not active.
    let nextStatus = status ?? current.status;
    if (nextStatus === 'active' && !current.password_hash) nextStatus = 'invited';
    const wasActiveOwner = current.role === 'owner' && current.status === 'active';
    const staysActiveOwner = nextRole === 'owner' && nextStatus === 'active';
    if (wasActiveOwner && !staysActiveOwner && (await countActiveOwners(client)) <= 1) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.team.lastOwner' };
    }
    await client.query(
      `UPDATE console_admin_users
          SET role = $1, status = $2,
              token_version = CASE WHEN $2 = 'disabled' AND status <> 'disabled' THEN token_version + 1 ELSE token_version END,
              updated_at = NOW()
        WHERE id = $3`,
      [nextRole, nextStatus, id],
    );
    await client.query('COMMIT');
    return { user: await getAdminUserById(id), before: { role: current.role, status: current.status } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
