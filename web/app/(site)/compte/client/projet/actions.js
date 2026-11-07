'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentCustomerId, getCustomerById } from '@/lib/customers';
import { createLead } from '@/lib/adminApi';
import { getT } from '@/lib/i18n/server';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import {
  MOVE_LEAD_SOURCE,
  MOVE_RESEND_AFTER_MS,
  moveCriteriaFr,
  moveRequestBlocker,
  moveStoryFr,
  parseMoveProject,
} from '@/lib/moveProjectRules';
import { getMoveProject, markMoveProjectSent, saveProjectAndAlert } from '@/lib/moveProjects';

function revalidateProject() {
  revalidatePath('/compte/client/projet');
  revalidatePath('/compte/client');
  revalidatePath('/compte/client/favoris');
}

/**
 * "Enregistrer mon projet" from the cards (/compte/client/projet/modifier).
 * The customer id comes from the session, never the form.
 */
export async function saveMoveProjectAction(formData) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet/modifier');

  let raw = {};
  try {
    raw = JSON.parse(String(formData.get('moveProject') || '{}'));
  } catch {
    raw = {};
  }
  const { project } = parseMoveProject(raw);
  const { saved } = await saveProjectAndAlert(customerId, project, await getT());
  if (!saved) redirect('/compte/client/projet/modifier?error=save');
  revalidateProject();
  redirect('/compte/client/projet');
}

/**
 * "Envoyer ma demande aux agences": the project becomes a real lead
 * (POST /admin/leads), which the engine pushes to the agencies covering the
 * communes (services/leadDispatch.js) — the same path the "Trouver pour moi"
 * form uses. Only on this explicit tap: answering the cards never contacts
 * anyone. Returns state for useActionState.
 */
export async function sendMoveRequestAction() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return { status: 'error', code: 'send' };
  const [customer, project] = await Promise.all([getCustomerById(customerId), getMoveProject(customerId)]);
  if (!customer?.phone || !project) return { status: 'error', code: 'send' };

  const blocker = moveRequestBlocker(project);
  if (blocker) return { status: 'error', code: blocker };
  if (project.lastLeadAt && Date.now() - new Date(project.lastLeadAt).getTime() < MOVE_RESEND_AFTER_MS) {
    return { status: 'error', code: 'recent' };
  }

  const story = moveStoryFr(project);
  const criteria = moveCriteriaFr(project);
  let leadId = null;
  try {
    const { lead } = await createLead({
      waId: customer.phone,
      name: customer.full_name || null,
      source: MOVE_LEAD_SOURCE,
      // Story first: the agent's card shows three lines (AgentLeadCard).
      requirementsSummary: [story, criteria].filter(Boolean).join('\n') || null,
      transactionType: project.transactionType,
      commune: project.communes[0],
      communes: project.communes,
      priceMax: project.budgetMax,
      bedrooms: project.bedroomsMin,
      moveStory: story || undefined,
    });
    leadId = lead?.id ?? null;
  } catch (err) {
    console.error(`[move-project] lead creation failed for customer #${customerId}: ${err.message}`);
    return { status: 'error', code: 'send' };
  }

  console.log(`[move-project] lead #${leadId} from customer #${customerId} ${project.transactionType} ${project.communes.join(',')}`);
  if (leadId) {
    await markMoveProjectSent(customerId, leadId);
    await recordAdEventFromAction({ name: 'Lead', eventId: `lead-m-${leadId}`, phone: customer.phone });
  }
  revalidateProject();
  revalidatePath('/compte/client/messages');
  return { status: 'sent' };
}
