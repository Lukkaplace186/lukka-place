'use server';

import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { getAgentById } from '@/lib/agents';
import { sendWhatsAppMessage } from '@/lib/adminApi';
import { verificationReminderText } from '@/lib/verificationReminder';
import { getT } from '@/lib/i18n/server';

/**
 * "Rappeler de vérifier": one WhatsApp message to the agent, through the
 * engine (the only holder of the WhatsApp credentials). It is a session
 * message — no template is approved for it — so Meta delivers it only if the
 * agent wrote to the business number in the last 24 hours; the toast says
 * "sent", never "delivered", for that reason.
 */
export async function sendVerificationReminderAction(agentId) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const agent = await getAgentById(Number.parseInt(agentId, 10));
    if (!agent) return { ok: false, error: t('errors.agentNotFound') };
    const phone = String(agent.phone || '').replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(phone)) return { ok: false, error: t('admin.agents.reminderNoPhone') };

    await sendWhatsAppMessage(phone, verificationReminderText(agent.first_name));
    await recordAudit(session, { action: 'agent.verification_reminder', entityType: 'agent', entityId: agent.id, details: {} });
    return { ok: true, message: t('admin.agents.reminderSent') };
  } catch (err) {
    console.error(`[admin/agents] verification reminder for #${agentId} failed: ${err.message}`);
    return { ok: false, error: t('admin.agents.reminderFailed') };
  }
}
