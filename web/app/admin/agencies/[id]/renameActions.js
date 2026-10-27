'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { isPhoneLikeName } from '@/lib/agentIdentity';
import { getT } from '@/lib/i18n/server';

/**
 * "Renommer l'agence": the public name of an agency is each of its agents'
 * `agents.agency_name` (AGENCY_NAME_EXPR on every card and profile), so the
 * new name is written on every live agent of the vendor in one statement.
 * `vendors.username` is left alone: it is the Laravel back-office login, and
 * the console only reads it as a name when it is not a phone number
 * (lib/vendorName.js) — the reply says so when that is the case.
 */
export async function renameAgencyAction(vendorId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const id = Number.parseInt(vendorId, 10);
    const name = String(formData.get('agency_name') || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: t('errors.actionFailed') };
    if (name.length < 2 || isPhoneLikeName(name)) return { ok: false, error: t('admin.agencies.renameInvalid') };

    const pool = getPool();
    const { rows: vendor } = await pool.query('SELECT id, username FROM vendors WHERE id = $1', [id]);
    if (!vendor.length) return { ok: false, error: t('errors.actionFailed') };
    const { rowCount } = await pool.query(
      'UPDATE agents SET agency_name = $1, updated_at = NOW() WHERE vendor_id = $2 AND deleted_at IS NULL',
      [name, id],
    );
    await recordAudit(session, { action: 'agency.rename', entityType: 'agency', entityId: id, details: { name, agents: rowCount } });
    revalidatePath(`/admin/agencies/${id}`);
    revalidatePath('/admin/agencies');
    revalidatePath('/listings');
    const usernameWins = vendor[0].username && !isPhoneLikeName(String(vendor[0].username));
    return {
      ok: true,
      message: usernameWins
        ? t('admin.agencies.renamedButLogin', { count: rowCount, login: vendor[0].username })
        : t('admin.agencies.renamed', { count: rowCount }),
    };
  } catch (err) {
    console.error(`[admin/agencies] rename #${vendorId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
