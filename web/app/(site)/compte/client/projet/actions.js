'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addSavedSearch, getCurrentCustomerId, removeSavedSearch } from '@/lib/customers';
import { updateLeadStatus } from '@/lib/adminApi';
import { buildSearchLabel } from '@/lib/searchLabel';
import { getT } from '@/lib/i18n/server';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import {
  MOVE_MANUAL_STAGES,
  cleanProjectTitle,
  cleanStory,
  moveSearchQuery,
  parseMoveProject,
} from '@/lib/moveProjectRules';
import { autoSendMoveProject, sendMoveProjectRequest } from '@/lib/moveProjectRequest';
import {
  deleteMoveProject,
  getMoveProject,
  listMoveProjects,
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
  // A project that was never sent goes to agencies now, once it says rent or
  // buy and where (lib/moveProjectRequest.js). An edit of a project already
  // sent alerts nobody. Never throws.
  const sent = await autoSendMoveProject(customerId, result.id);
  if (sent.status === 'sent' && sent.leadId) {
    await recordAdEventFromAction({ name: 'Lead', eventId: `lead-m-${sent.leadId}`, phone: sent.phone });
    revalidatePath('/compte/client/messages');
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
  // Called from the stepper (components ProjectStepper.js), forward or back,
  // and by its "Annuler"; 'auto' hands the stage back to the tracking.
  // Returns state for the client — the stepper updates at once and shows
  // an undo toast, then refreshes the page around it.
  const customerId = await getCurrentCustomerId();
  if (!customerId) return { ok: false, reason: 'session' };
  const project = await getMoveProject(customerId, projectIdOf(projectId));
  if (!project) return { ok: false, reason: 'missing' };
  // Once found, "Ce n'était pas le bon" is the way back (it restarts the alert).
  if (project.status === 'found') return { ok: false, reason: 'found' };
  const value = stage === 'auto' ? null : stage;
  if (value !== null && !MOVE_MANUAL_STAGES.includes(value)) return { ok: false, reason: 'stage' };
  const ok = await setMoveProjectManualStage(customerId, project.id, value);
  if (ok) console.log(`[move-project] project #${project.id}: customer set stage ${value ?? 'auto'}`);
  revalidateProjects(project.id);
  return { ok, reason: ok ? null : 'save' };
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
 * (POST /admin/leads), which the engine offers to the best-ranked agencies in
 * waves (services/leadDispatch.js) — lib/moveProjectRequest.js. Since
 * 2026-11-16 a project is also sent by itself when saved (autoSendMoveProject);
 * this tap is the resend, at most once per MOVE_RESEND_AFTER_MS. Bound to the
 * project id by the page; returns useActionState state.
 */
export async function sendMoveRequestAction(projectId) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return { status: 'error', code: 'send' };
  const id = projectIdOf(projectId);
  const result = await sendMoveProjectRequest(customerId, id, { origin: 'customer' });
  if (result.status !== 'sent') {
    // A found or paused move, or no number: the generic message.
    const shown = ['transaction', 'communes', 'recent'].includes(result.code) ? result.code : 'send';
    return { status: 'error', code: shown };
  }
  if (result.leadId) await recordAdEventFromAction({ name: 'Lead', eventId: `lead-m-${result.leadId}`, phone: result.phone });
  revalidateProjects(id);
  revalidatePath('/compte/client/messages');
  return { status: 'sent' };
}
