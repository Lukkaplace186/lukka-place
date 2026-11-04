'use server';

import { revalidatePath } from 'next/cache';
import { recordTeamIntroduction } from '@/lib/adminApi';
import { getListingLabels } from '@/lib/adminLeadRouting';
import { recordAudit } from '@/lib/adminAudit';
import { requireAdmin } from '@/lib/adminSession';
import { getAgentById } from '@/lib/agents';
import { agentDisplayName } from '@/lib/agencies';
import { getT } from '@/lib/i18n/server';
import { INTRODUCTION_CHANNELS } from '@/lib/interactionCounts';
import { phoneFromForm } from '@/lib/phone';

/**
 * "Mise en relation" — the desk records that it put a customer in touch with
 * an agent outside the site (a phone call to the agent, as on 2026-11-04).
 * The engine stores it as a lead in that agent's Demandes inbox and sends
 * nothing (engine services/teamIntroduction.js). Everything is re-checked
 * here: the agent exists and is not deleted, the listing exists.
 *
 * @returns {Promise<{ok: true, leadId: number} | {ok: false, error: string}>}
 */
export async function recordIntroductionAction(formData) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('leads.manage');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const waId = phoneFromForm(formData, 'phone');
  if (!waId) return { ok: false, error: t('admin.interactions.form.errors.phone') };

  const agent = await getAgentById(String(formData.get('agent_id') || ''));
  if (!agent) return { ok: false, error: t('admin.interactions.form.errors.agent') };

  const channel = String(formData.get('channel') || '');
  if (!INTRODUCTION_CHANNELS.includes(channel)) return { ok: false, error: t('admin.interactions.form.errors.channel') };

  const rawListing = String(formData.get('property_id') || '').trim().replace(/^#/, '');
  let propertyId = null;
  if (rawListing) {
    propertyId = /^\d{1,12}$/.test(rawListing) ? Number(rawListing) : null;
    if (!propertyId) return { ok: false, error: t('admin.interactions.form.errors.listing') };
    try {
      const labels = await getListingLabels([propertyId]);
      if (!labels.has(propertyId)) return { ok: false, error: t('admin.interactions.form.errors.listingMissing', { id: propertyId }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  let lead;
  try {
    ({ lead } = await recordTeamIntroduction({
      waId,
      name: String(formData.get('name') || '').trim().slice(0, 120) || null,
      agentId: Number(agent.id),
      assignedAgent: agentDisplayName(agent),
      propertyId,
      channel,
      note: String(formData.get('note') || '').trim().slice(0, 1000) || null,
      recordedBy: session.shared ? null : session.name || null,
      agentContacted: formData.get('agent_contacted') === 'on',
    }));
  } catch (err) {
    console.error(`[admin/interactions] record failed: ${err.message}`);
    return { ok: false, error: t('admin.interactions.form.errors.engine', { error: err.message }) };
  }

  // No customer number in the audit row: the lead holds it.
  await recordAudit(session, {
    action: 'lead.team_introduction',
    entityType: 'lead',
    entityId: lead.id,
    details: { agentId: Number(agent.id), channel, propertyId, contacted: lead.status !== 'NEW' },
  });
  revalidatePath('/admin/interactions');
  revalidatePath('/admin/leads');
  return { ok: true, leadId: lead.id };
}
