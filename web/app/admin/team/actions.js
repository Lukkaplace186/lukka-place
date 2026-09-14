'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { createAdminInvite, reissueAdminAccess, updateAdminUser } from '@/lib/adminUsers';
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

export async function inviteAdminAction({ fullName, email, role }) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await createAdminInvite({ fullName, email, role, invitedBy: session.id });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'team.invite',
      entityType: 'team',
      entityId: result.user.id,
      details: { email: result.user.email, role: result.user.role },
    });
    revalidatePath('/admin/team');
    return { ok: true, message: t('admin.team.invited'), link: activationLink(result.token), name: result.user.full_name };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function updateAdminRoleAction(adminId, role) {
  const t = await getT();
  try {
    const session = await requireAdmin('team.manage');
    const result = await updateAdminUser(Number(adminId), { role });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, { action: 'team.role', entityType: 'team', entityId: adminId, details: { from: result.before.role, to: role } });
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
