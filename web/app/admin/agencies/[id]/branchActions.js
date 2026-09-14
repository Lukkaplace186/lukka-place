'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import {
  BRANCH_NAME_MAX, archiveAgencyBranch, assignAgentsToBranch, createAgencyBranch, updateAgencyBranch,
} from '@/lib/adminBranches';
import { getLocationHierarchySafe } from '@/lib/locations';
import { getT } from '@/lib/i18n/server';

/**
 * Branch management on /admin/agencies/[id]. Same permission as editing an
 * agent (`agents.manage`), every change audited against the agency, every
 * membership change audited against each agent it moved.
 */

// The shared-password session has no console_admin_users row to point at.
function adminIdOf(session) {
  return session?.shared ? null : session?.id ?? null;
}

function positiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function saveBranchAction(vendorId, branchId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const vendor = positiveInt(vendorId);
    if (!vendor) return { ok: false, error: t('admin.branches.agencyMissing') };

    const name = String(formData.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > BRANCH_NAME_MAX) return { ok: false, error: t('admin.branches.nameInvalid', { max: BRANCH_NAME_MAX }) };

    // Communes are never typed free-hand: the value must be one the location
    // hierarchy knows. If the hierarchy is unreachable, a commune is refused
    // rather than stored unchecked.
    const communeInput = String(formData.get('commune') || '').trim();
    let commune = null;
    if (communeInput) {
      const { communes } = await getLocationHierarchySafe();
      if (!communes.includes(communeInput)) return { ok: false, error: t('admin.branches.communeInvalid') };
      commune = communeInput;
    }

    const phone = String(formData.get('phone') || '').replace(/\D/g, '');
    if (phone && !/^\d{7,15}$/.test(phone)) return { ok: false, error: t('admin.branches.phoneInvalid') };

    const existing = positiveInt(branchId);
    const values = { vendorId: vendor, name, commune, phone: phone || null };
    const result = existing
      ? await updateAgencyBranch({ ...values, branchId: existing })
      : await createAgencyBranch({ ...values, adminId: adminIdOf(session) });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };

    await recordAudit(session, {
      action: existing ? 'agency.branch_update' : 'agency.branch_create',
      entityType: 'agency',
      entityId: vendor,
      details: { branchId: result.id, name, commune, phone: phone || null },
    });
    revalidatePath(`/admin/agencies/${vendor}`);
    return { ok: true, message: t(existing ? 'admin.branches.updated' : 'admin.branches.created') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function archiveBranchAction(vendorId, branchId) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const vendor = positiveInt(vendorId);
    const branch = positiveInt(branchId);
    if (!vendor || !branch) return { ok: false, error: t('admin.branches.notFound') };
    const result = await archiveAgencyBranch({ vendorId: vendor, branchId: branch });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'agency.branch_archive', entityType: 'agency', entityId: vendor, details: { branchId: branch, released: result.released },
    });
    revalidatePath(`/admin/agencies/${vendor}`);
    return { ok: true, message: t('admin.branches.archived', { count: result.released }) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** `branchId` empty or null takes the agents out of any branch. */
export async function assignBranchAction(vendorId, agentIds, branchId) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const vendor = positiveInt(vendorId);
    if (!vendor) return { ok: false, error: t('admin.branches.agencyMissing') };
    const branch = branchId === '' || branchId == null ? null : positiveInt(branchId);
    if (branchId !== '' && branchId != null && !branch) return { ok: false, error: t('admin.branches.notFound') };

    const { changedIds } = await assignAgentsToBranch({ vendorId: vendor, branchId: branch, agentIds, adminId: adminIdOf(session) });
    for (const id of changedIds) {
      await recordAudit(session, {
        action: 'agent.branch', entityType: 'agent', entityId: id, details: { vendorId: vendor, branchId: branch, bulk: changedIds.length },
      });
    }
    revalidatePath(`/admin/agencies/${vendor}`);
    return {
      ok: true,
      message: branch ? t('admin.branches.assigned', { count: changedIds.length }) : t('admin.branches.unassigned', { count: changedIds.length }),
    };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
