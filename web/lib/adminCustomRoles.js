import 'server-only';
import { getPool } from './db';
import { cleanCustomPermissions, customRoleKey } from './adminRoles';

/**
 * Custom console roles (`console_admin_custom_roles`,
 * migrations/20261126_admin_combined_custom_roles.sql): a name an owner picks
 * plus a list of permissions from lib/adminRoles.js PERMISSIONS. A person
 * holds one through the key `custom:<id>` in `console_admin_users.roles`.
 *
 * Before the migration runs (the web app can deploy first) there are simply
 * no custom roles: reads return [], writes return `admin.team.migrationMissing`.
 *
 * Permissions are re-cleaned on every read as well as every write, so a
 * permission later removed from the code, or `team.manage` written by hand
 * into the table, is never granted.
 */

const MISSING = new Set(['42P01', '42703']);
const isMissing = (err) => MISSING.has(err?.code);

export const CUSTOM_ROLE_NAME_MAX = 60;
export const CUSTOM_ROLE_DESCRIPTION_MAX = 200;

function toRole(row) {
  return {
    id: Number(row.id),
    key: customRoleKey(row.id),
    name: row.name,
    description: row.description || '',
    permissions: cleanCustomPermissions(row.permissions || []),
    holders: row.holders == null ? 0 : Number(row.holders),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Every custom role, with how many accounts hold it. */
export async function listCustomRoles() {
  try {
    const { rows } = await getPool().query(
      `SELECT r.id, r.name, r.description, r.permissions, r.created_at, r.updated_at,
              (SELECT COUNT(*)::int FROM console_admin_users u
                WHERE ('custom:' || r.id::text) = ANY(u.roles)) AS holders
         FROM console_admin_custom_roles r
        ORDER BY LOWER(r.name)`,
    );
    return rows.map(toRole);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** The custom roles behind these ids (a session's own), no holder counts. */
export async function getCustomRolesByIds(ids) {
  const clean = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!clean.length) return [];
  try {
    const { rows } = await getPool().query(
      'SELECT id, name, description, permissions, created_at, updated_at FROM console_admin_custom_roles WHERE id = ANY($1::bigint[])',
      [clean],
    );
    return rows.map(toRole);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

function cleanInput({ name, description, permissions }) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, CUSTOM_ROLE_NAME_MAX);
  if (!cleanName) return { errorKey: 'admin.team.custom.nameRequired' };
  const cleanPermissions = cleanCustomPermissions(permissions);
  if (!cleanPermissions.length) return { errorKey: 'admin.team.custom.permissionsRequired' };
  return {
    values: {
      name: cleanName,
      description: String(description || '').trim().slice(0, CUSTOM_ROLE_DESCRIPTION_MAX),
      permissions: cleanPermissions,
    },
  };
}

/** @returns {Promise<{role: object} | {errorKey: string}>} */
export async function createCustomRole(input, { createdBy = null } = {}) {
  const { values, errorKey } = cleanInput(input);
  if (errorKey) return { errorKey };
  try {
    const { rows } = await getPool().query(
      `INSERT INTO console_admin_custom_roles (name, description, permissions, created_by)
       VALUES ($1, $2, $3::text[], $4)
       RETURNING id, name, description, permissions, created_at, updated_at`,
      [values.name, values.description, values.permissions, createdBy],
    );
    return { role: toRole(rows[0]) };
  } catch (err) {
    if (err.code === '23505') return { errorKey: 'admin.team.custom.nameTaken' };
    if (isMissing(err)) return { errorKey: 'admin.team.migrationMissing' };
    throw err;
  }
}

/**
 * Rename a custom role or change what it allows. Takes effect on each
 * holder's next page or action (lib/adminSession.js reads it every request).
 * @returns {Promise<{role: object, before: object} | {errorKey: string}>}
 */
export async function updateCustomRole(id, input) {
  const { values, errorKey } = cleanInput(input);
  if (errorKey) return { errorKey };
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT id, name, description, permissions FROM console_admin_custom_roles WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.team.custom.notFound' };
    }
    const { rows } = await client.query(
      `UPDATE console_admin_custom_roles
          SET name = $1, description = $2, permissions = $3::text[], updated_at = NOW()
        WHERE id = $4
        RETURNING id, name, description, permissions, created_at, updated_at`,
      [values.name, values.description, values.permissions, id],
    );
    await client.query('COMMIT');
    return { role: toRole(rows[0]), before: toRole(current.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return { errorKey: 'admin.team.custom.nameTaken' };
    if (isMissing(err)) return { errorKey: 'admin.team.migrationMissing' };
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete a custom role nobody holds any more. Refused while it is assigned:
 * silently stripping it could leave someone with no role at all, so the
 * owner takes it off each person first.
 * @returns {Promise<{role: object} | {errorKey: string, count?: number}>}
 */
export async function deleteCustomRole(id) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT id, name, description, permissions FROM console_admin_custom_roles WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.team.custom.notFound' };
    }
    const held = await client.query(
      'SELECT COUNT(*)::int AS n FROM console_admin_users WHERE $1 = ANY(roles)',
      [customRoleKey(id)],
    );
    const count = held.rows[0]?.n ?? 0;
    if (count > 0) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.team.custom.stillAssigned', count };
    }
    await client.query('DELETE FROM console_admin_custom_roles WHERE id = $1', [id]);
    await client.query('COMMIT');
    return { role: toRole(current.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isMissing(err)) return { errorKey: 'admin.team.migrationMissing' };
    throw err;
  } finally {
    client.release();
  }
}
