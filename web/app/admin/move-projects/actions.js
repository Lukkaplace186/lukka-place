'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { sendMoveProjectRequest } from '@/lib/moveProjectRequest';
import { getT } from '@/lib/i18n/server';

/**
 * "Envoyer aux agences" on /admin/move-projects (2026-11-16): the desk sends
 * a customer's project to agencies when it never went — the 9 projects saved
 * before the automatic send, or one whose send failed. Same function as the
 * customer's own button (lib/moveProjectRequest.js): one `move-project` lead,
 * offered to the best-ranked agencies in waves; the customer's number reaches
 * an agency only when it takes the request. This messages real agencies, so
 * the button asks for a confirmation first (SendProjectButton).
 */
export async function sendProjectToAgenciesAction(customerId, projectId) {
  const t = await getT();
  try {
    const session = await requireAdmin('leads.manage');
    const customer = Number.parseInt(customerId, 10);
    const project = Number.parseInt(projectId, 10);
    if (!Number.isInteger(customer) || customer <= 0 || !Number.isInteger(project) || project < 0) {
      return { ok: false, error: t('errors.actionFailed') };
    }
    const result = await sendMoveProjectRequest(customer, project, { origin: 'admin' });
    if (result.status !== 'sent') {
      const known = ['transaction', 'communes', 'recent', 'inactive', 'phone'];
      return { ok: false, error: t(`admin.moveProjects.sendBlocked.${known.includes(result.code) ? result.code : 'send'}`) };
    }
    await recordAudit(session, {
      action: 'move_project.sent_to_agencies',
      entityType: 'customer',
      entityId: customer,
      details: { projectId: project, leadId: result.leadId },
    });
    revalidatePath('/admin/move-projects');
    return { ok: true, message: t('admin.moveProjects.sentNow', { id: result.leadId ?? '—' }) };
  } catch (err) {
    console.error(`[admin] move project ${customerId}/${projectId} to agencies: ${err.message}`);
    return { ok: false, error: t('errors.actionFailed') };
  }
}
