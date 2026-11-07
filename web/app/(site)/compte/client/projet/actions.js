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
  cleanProjectTitle,
  moveCriteriaFr,
  moveRequestBlocker,
  moveStoryFr,
  parseMoveProject,
} from '@/lib/moveProjectRules';
import { deleteMoveProject, getMoveProject, markMoveProjectSent, saveProjectAndAlert } from '@/lib/moveProjects';

/**
 * "Mon déménagement" actions. The customer comes from the session, never the
 * form; a project id is only ever looked up among that customer's own
 * projects (lib/moveProjects.js scopes every statement by customer_id).
 */

function revalidateProjects(projectId = null) {
  revalidatePath('/compte/client/projet');
  if (projectId != null) revalidatePath(`/compte/client/projet/${projectId}`);
  revalidatePath('/compte/client');
  revalidatePath('/compte/client/favoris');
}

/** A project id from a form or a binding: a non-negative integer, or null (= a new project). */
function projectIdOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

/**
 * "Enregistrer mon projet" from the cards: updates the project named by the
 * hidden `projectId` field (one of the customer's own), or creates a new one
 * when there is none — refused past five (lib/moveProjects.js).
 */
export async function saveMoveProjectAction(formData) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');

  let raw = {};
  try {
    raw = JSON.parse(String(formData.get('moveProject') || '{}'));
  } catch {
    raw = {};
  }
  const { project } = parseMoveProject(raw);
  const title = cleanProjectTitle(formData.get('title'));
  const projectId = projectIdOf(formData.get('projectId'));
  if (projectId != null && !(await getMoveProject(customerId, projectId))) redirect('/compte/client/projet');

  const result = await saveProjectAndAlert(customerId, project, await getT(), { projectId, title });
  if (result.limit) redirect('/compte/client/projet?limite=1');
  if (!result.saved) {
    redirect(projectId != null ? `/compte/client/projet/${projectId}/modifier?error=save` : '/compte/client/projet/nouveau?error=save');
  }
  revalidateProjects(result.id);
  redirect(`/compte/client/projet/${result.id}${projectId == null ? '?nouveau=1' : ''}`);
}

/** "Supprimer ce projet" (after the customer confirmed in the dialog). */
export async function deleteMoveProjectAction(projectId) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');
  const id = projectIdOf(projectId);
  if (id != null) await deleteMoveProject(customerId, id);
  revalidateProjects();
  redirect('/compte/client/projet');
}

/**
 * "Envoyer ma demande aux agences" for one project: it becomes a real lead
 * (POST /admin/leads), which the engine pushes to the agencies covering the
 * communes (services/leadDispatch.js) — the same path the "Trouver pour moi"
 * form uses. Only on this explicit tap: answering the cards never contacts
 * anyone. Bound to the project id by the page; returns useActionState state.
 */
export async function sendMoveRequestAction(projectId) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return { status: 'error', code: 'send' };
  const id = projectIdOf(projectId);
  const [customer, project] = await Promise.all([
    getCustomerById(customerId),
    id == null ? null : getMoveProject(customerId, id),
  ]);
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
      priceMin: project.budgetMin,
      priceMax: project.budgetMax,
      bedrooms: project.bedroomsMin,
      moveStory: story || undefined,
    });
    leadId = lead?.id ?? null;
  } catch (err) {
    console.error(`[move-project] lead creation failed for customer #${customerId}: ${err.message}`);
    return { status: 'error', code: 'send' };
  }

  console.log(`[move-project] lead #${leadId} from customer #${customerId} project #${project.id} ${project.transactionType} ${project.communes.join(',')}`);
  if (leadId) {
    await markMoveProjectSent(customerId, project.id, leadId);
    await recordAdEventFromAction({ name: 'Lead', eventId: `lead-m-${leadId}`, phone: customer.phone });
  }
  revalidateProjects(project.id);
  revalidatePath('/compte/client/messages');
  return { status: 'sent' };
}
