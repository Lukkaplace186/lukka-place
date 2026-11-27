'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { hasPartnerAgencies, setPartnerAgency } from '@/lib/partnerAgencies';
import { getT } from '@/lib/i18n/server';

/**
 * "Agence partenaire" on an agency's page (lib/partnerAgencies.js): marks or
 * unmarks it, so the approval queue shows its listings apart and badges them.
 * Console-only — nothing public changes.
 */
export async function setPartnerAgencyAction(vendorId, partner) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const id = Number.parseInt(vendorId, 10);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: t('errors.actionFailed') };
    if (!(await hasPartnerAgencies())) return { ok: false, error: t('admin.agencies.partner.unavailable') };
    const { rows } = await getPool().query('SELECT id FROM vendors WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) return { ok: false, error: t('errors.actionFailed') };

    const on = Boolean(partner);
    const changed = await setPartnerAgency(id, on, { adminId: session.id ?? null });
    if (changed) {
      await recordAudit(session, { action: on ? 'agency.partner_on' : 'agency.partner_off', entityType: 'agency', entityId: id, details: {} });
    }
    revalidatePath(`/admin/agencies/${id}`);
    revalidatePath('/admin/agencies');
    revalidatePath('/admin/listings');
    return { ok: true, message: t(on ? 'admin.agencies.partner.marked' : 'admin.agencies.partner.unmarked') };
  } catch (err) {
    console.error(`[admin] partner agency ${vendorId}: ${err.message}`);
    return { ok: false, error: t('errors.actionFailed') };
  }
}
