'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { createAdminInvite, deleteAdminUser, reissueAdminAccess, updateAdminUser } from '@/lib/adminUsers';
import { createCustomRole, deleteCustomRole, updateCustomRole } from '@/lib/adminCustomRoles';
import { getT } from '@/lib/i18n/server';

/**
 * Team management — owner only. No password ever passes through here: an
 * invite or an access reset produces a single-use link the person uses to set
 * their own. The link is returned ONCE for the owner to send; only its hash is
 * stored.
 */

function activationLink(token) {
  const base = String(process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/$/, '');
  return `${base}/admin/activate?token=${encodeURIComponent(token)}`;
}

export async function inviteAdminAction({ fullName, email, roles }) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await createAdminInvite({ fullName, email, roles, invitedBy: session.id });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'team.invite',
      entityType: 'team',
      entityId: result.user.id,
      details: { email: result.user.email, roles: result.user.roles },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.invited'), link: activationLink(result.token), name: result.user.full_name };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** Replace everything a person holds with `roles` (one or several, built-in or custom). */
export async function updateAdminRolesAction(adminId, roles) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await updateAdminUser(Number(adminId), { roles });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'team.role',
      entityType: 'team',
      entityId: adminId,
      details: { from: result.before.roles, to: result.user.roles },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.roleChanged') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function setAdminStatusAction(adminId, status) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await updateAdminUser(Number(adminId), { status });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, { action: 'team.status', entityType: 'team', entityId: adminId, details: { from: result.before.status, to: result.user.status } });
    revalidatePath('/admin/team');
    return { ok: true, message: status === 'disabled' ? t('admin.team.disabled') : t('admin.team.enabled') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** A fresh activation link; the account's existing sessions end immediately. */
export async function reissueAdminAccessAction(adminId) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await reissueAdminAccess(Number(adminId));
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, { action: 'team.access_reissued', entityType: 'team', entityId: adminId });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.reissued'), link: activationLink(result.token) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/**
 * Permanently delete a disabled account or an unused invitation. The audit
 * entry keeps who it was; their past actions keep their name (actor_label).
 */
export async function deleteAdminUserAction(adminId) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    if (session.id != null && Number(adminId) === Number(session.id)) return { ok: false, error: t('admin.team.deleteSelf') };
    const result = await deleteAdminUser(Number(adminId));
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'team.delete',
      entityType: 'team',
      entityId: adminId,
      details: { name: result.user.full_name, email: result.user.email, roles: result.user.roles, status: result.user.status },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.deleted', { name: result.user.full_name }) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

// ── Custom roles ─────────────────────────────────────────────────────────────

export async function createCustomRoleAction({ name, description, permissions }) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await createCustomRole({ name, description, permissions }, { createdBy: session.id });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'team.custom_role.create',
      entityType: 'team',
      entityId: result.role.key,
      details: { name: result.role.name, permissions: result.role.permissions },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.custom.created', { name: result.role.name }) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function updateCustomRoleAction(roleId, { name, description, permissions }) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await updateCustomRole(Number(roleId), { name, description, permissions });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'team.custom_role.update',
      entityType: 'team',
      entityId: result.role.key,
      details: {
        name: { from: result.before.name, to: result.role.name },
        added: result.role.permissions.filter((p) => !result.before.permissions.includes(p)),
        removed: result.before.permissions.filter((p) => !result.role.permissions.includes(p)),
      },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.custom.updated', { name: result.role.name }) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function deleteCustomRoleAction(roleId) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await deleteCustomRole(Number(roleId));
    if (result.errorKey) return { ok: false, error: t(result.errorKey, { count: result.count ?? 0 }) };
    await recordAudit(session, {
      action: 'team.custom_role.delete',
      entityType: 'team',
      entityId: result.role.key,
      details: { name: result.role.name, permissions: result.role.permissions },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.custom.deletedOk', { name: result.role.name }) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
