'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addSavedSearch, getCurrentCustomerId, getCustomerById, removeSavedSearch } from '@/lib/customers';
import { createLead, updateLeadStatus } from '@/lib/adminApi';
import { buildSearchLabel } from '@/lib/searchLabel';
import { getT } from '@/lib/i18n/server';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import {
  MOVE_LEAD_SOURCE,
  MOVE_MANUAL_STAGES,
  MOVE_RESEND_AFTER_MS,
  cleanProjectTitle,
  cleanStory,
  moveCriteriaFr,
  moveRequestBlocker,
  moveSearchQuery,
  moveStoryFr,
  parseMoveProject,
} from '@/lib/moveProjectRules';
import {
  deleteMoveProject,
  getMoveProject,
  listMoveProjects,
  markMoveProjectSent,
  recordSettledCheckin,
  saveProjectAndAlert,
  setMoveProjectManualStage,
  setMoveProjectStatus,
} from '@/lib/moveProjects';

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

/**
 * Whether another of the customer's still-searching projects runs on the same
 * saved search — then stopping this one must not stop the shared alert.
 */
async function alertSharedWithAnother(customerId, project, query) {
  const others = (await listMoveProjects(customerId)).filter((p) => p.id !== project.id && p.status === 'active');
  return others.some((p) => moveSearchQuery(p) === query);
}

async function stopProjectAlert(customerId, project) {
  const query = moveSearchQuery(project);
  if (!query || (await alertSharedWithAnother(customerId, project, query))) return;
  try {
    await removeSavedSearch(customerId, query);
  } catch (err) {
    console.warn(`[move-project] could not stop the alert of project #${project.id}: ${err.message}`);
  }
}

/**
 * "C'est le bon !" — the customer found their home. The project is marked
 * found, its alert stops (no more homes for a search that is over), and the
 * request it sent to agencies becomes CONVERTED — the lead status no code
 * path could reach before. Nothing is sent to anyone.
 */
export async function markProjectFoundAction(projectId) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');
  const project = await getMoveProject(customerId, projectIdOf(projectId));
  if (!project) redirect('/compte/client/projet');
  const ok = await setMoveProjectStatus(customerId, project.id, 'found');
  if (ok) {
    await stopProjectAlert(customerId, project);
    if (project.lastLeadId) {
      try {
        await updateLeadStatus(project.lastLeadId, 'CONVERTED');
      } catch (err) {
        console.warn(`[move-project] lead #${project.lastLeadId} not marked CONVERTED: ${err.message}`);
      }
    }
    console.log(`[move-project] project #${project.id} of customer #${customerId} found${project.lastLeadId ? `, lead #${project.lastLeadId} converted` : ''}`);
  }
  revalidateProjects(project.id);
  redirect(`/compte/client/projet/${project.id}${ok ? '?trouve=1' : '?error=status'}`);
}

/** "Mettre en pause": the search stops (and its alert) without losing the project. */
export async function pauseProjectAction(projectId) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');
  const project = await getMoveProject(customerId, projectIdOf(projectId));
  if (!project) redirect('/compte/client/projet');
  const ok = await setMoveProjectStatus(customerId, project.id, 'paused');
  if (ok) await stopProjectAlert(customerId, project);
  revalidateProjects(project.id);
  redirect(`/compte/client/projet/${project.id}${ok ? '' : '?error=status'}`);
}

/** "Reprendre la recherche" — from a pause, or "ce n'était pas le bon" after found. The alert comes back. */
export async function resumeProjectAction(projectId) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');
  const project = await getMoveProject(customerId, projectIdOf(projectId));
  if (!project) redirect('/compte/client/projet');
  const ok = await setMoveProjectStatus(customerId, project.id, 'active');
  const query = ok ? moveSearchQuery(project) : null;
  if (query) {
    try {
      const t = await getT();
      await addSavedSearch(customerId, { query, label: buildSearchLabel(new URLSearchParams(query), t) });
    } catch (err) {
      console.warn(`[move-project] alert not restarted for project #${project.id}: ${err.message}`);
    }
  }
  revalidateProjects(project.id);
  redirect(`/compte/client/projet/${project.id}${ok ? '' : '?error=status'}`);
}

/**
 * "Bien installés ?" (30 days after "C'est le bon !"): the answer, the
 * customer's story in their own words (optional), and — only if they ticked
 * it — their consent for Lukka Place to share that story. No consent, no use
 * outside their account.
 */
export async function settleCheckinAction(projectId, formData) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');
  const project = await getMoveProject(customerId, projectIdOf(projectId));
  if (!project) redirect('/compte/client/projet');
  const answer = formData.get('answer') === 'settled' ? 'settled' : 'not_yet';
  const story = cleanStory(formData.get('story'));
  const consent = formData.get('consent') === 'on' && Boolean(story);
  await recordSettledCheckin(customerId, project.id, { answer, story, consent });
  console.log(`[move-project] check-in project #${project.id}: ${answer}, story=${story ? 'yes' : 'no'}, consent=${consent}`);
  revalidateProjects(project.id);
  redirect(`/compte/client/projet/${project.id}?merci=1`);
}

/**
 * A tapped stage pill (owner, 2026-11-07): the customer says where their
 * move stands when the tracker missed it — "Demande envoyée", "Visites".
 * Only MOVE_MANUAL_STAGES; "trouvé" and "installé" have their own
 * confirmations because they stop the alert and close the request.
 */
export async function setManualStageAction(projectId, stage) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/projet');
  const project = await getMoveProject(customerId, projectIdOf(projectId));
  if (!project) redirect('/compte/client/projet');
  const ok = MOVE_MANUAL_STAGES.includes(stage) && (await setMoveProjectManualStage(customerId, project.id, stage));
  if (ok) console.log(`[move-project] project #${project.id}: customer set stage ${stage}`);
  revalidateProjects(project.id);
  redirect(`/compte/client/projet/${project.id}${ok ? '' : '?error=status'}`);
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
  // A found or paused move is not a search agencies should be working on.
  if (project.status !== 'active') return { status: 'error', code: 'send' };

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
