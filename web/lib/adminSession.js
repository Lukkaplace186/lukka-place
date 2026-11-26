import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { ADMIN_SESSION_COOKIE, parseSessionToken, sharedPasswordEnabled } from './adminAuth';
import { getAdminUserById } from './adminUsers';
import { PERMISSIONS, can, customRoleId, resolvePermissions } from './adminRoles';
import { getCustomRolesByIds } from './adminCustomRoles';

/**
 * Who is using the console right now, resolved once per request.
 *
 * middleware.js only proves a token was signed by us and has not expired. This
 * is the check that matters: the account still exists, is still active, and has
 * not had its access reset since the token was issued (`token_version`). It
 * runs in the admin layout for every page and in `requireAdmin` for every
 * Server Action — actions do not pass through the layout, so they must check
 * for themselves.
 *
 * `roles` is every role the person holds (primary first, `role`), and
 * `permissions` what they add up to — built-in rows plus each custom role's
 * list as it stands NOW, so editing a custom role applies on the next request.
 * `customRoleNames` labels the person's custom roles in the chrome.
 *
 * @returns {Promise<null | {id: number|null, shared: boolean, role: string, roles: string[],
 *   permissions: string[], customRoleNames: Record<string, string>, name: string, email: string|null}>}
 */
export const getAdminSession = cache(async () => {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const parsed = parseSessionToken(token);
  if (!parsed) return null;

  if (parsed.adminId === 0) {
    if (!sharedPasswordEnabled()) return null;
    return {
      id: null, shared: true, role: 'owner', roles: ['owner'], permissions: Object.keys(PERMISSIONS),
      customRoleNames: {}, name: 'Mot de passe partagé', email: null, tokenVersion: 0,
    };
  }

  let user = null;
  try {
    user = await getAdminUserById(parsed.adminId);
  } catch (err) {
    console.error(`[admin/session] could not load admin #${parsed.adminId}: ${err.message}`);
    return null;
  }
  if (!user || user.status !== 'active' || Number(user.token_version) !== parsed.tokenVersion) return null;
  const roles = user.roles?.length ? user.roles : [user.role];
  const customIds = roles.map(customRoleId).filter((id) => id !== null);
  let customRoles = [];
  if (customIds.length) {
    try {
      customRoles = await getCustomRolesByIds(customIds);
    } catch (err) {
      // Fail closed: without its custom roles the account keeps only what its built-in roles grant.
      console.error(`[admin/session] could not load custom roles for admin #${user.id}: ${err.message}`);
    }
  }
  return {
    id: user.id,
    shared: false,
    role: roles[0],
    roles,
    permissions: resolvePermissions(roles, customRoles),
    customRoleNames: Object.fromEntries(customRoles.map((role) => [role.key, role.name])),
    name: user.full_name,
    email: user.email,
    tokenVersion: Number(user.token_version),
  };
});

export class AdminAccessError extends Error {}

/**
 * The first line of every mutating admin Server Action.
 * @param {string|null} permission from lib/adminRoles.js PERMISSIONS
 */
export async function requireAdmin(permission = null) {
  const session = await getAdminSession();
  if (!session) throw new AdminAccessError('Session expirée — reconnectez-vous.');
  if (permission && !can(session, permission)) {
    throw new AdminAccessError(`Action non autorisée pour votre rôle (${permission}).`);
  }
  return session;
}

/** Set by middleware.js on every /admin request (overwriting anything a client sent). */
export async function getAdminPathname() {
  try {
    return (await headers()).get('x-admin-pathname') || '';
  } catch {
    return '';
  }
}
