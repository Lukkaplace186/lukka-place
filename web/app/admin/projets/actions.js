'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { uploadProjectImage } from '@/lib/listingStorage';
import {
  acknowledgeProjectChanges, addProjectImages, addProjectUpdate, createProject, requestProjectChanges, deleteLot, deleteProject, deleteProjectUpdate,
  deleteUnitType, getProjectForAdmin, removeProjectImage, saveLot, saveUnitType, setProjectPlanImage,
  setProjectPublished, setProjectVerified, updateProject,
} from '@/lib/developments';
import {
  publishBlockers, validateDevelopmentInput, validateLotInput, validateUnitTypeInput,
} from '@/lib/developmentRules';
import { HERO_MAX_UPLOAD_BYTES, HERO_UPLOAD_TYPES } from '@/lib/cmsHeroRules';
import { sendWhatsAppMessage } from '@/lib/adminApi';
import { forget } from '@/lib/memo';

/**
 * /admin/projets writes. Plain form posts that redirect back with
 * ?saved= / ?error=<i18n key suffix>, so every form works without script and
 * a refresh never re-submits. Each action re-checks the permission (Server
 * Actions do not pass through the layout) and is audited.
 */

const MAX_FILES = 10;

function back(id, params = {}) {
  const query = new URLSearchParams(params).toString();
  return `/admin/projets/${id}${query ? `?${query}` : ''}`;
}

function formObject(formData) {
  const value = {};
  for (const [key, entry] of formData.entries()) {
    if (typeof entry === 'string') value[key] = entry;
  }
  return value;
}

/** The payment plan arrives as parallel plan_label / plan_percent fields. */
function planFromForm(formData) {
  const labels = formData.getAll('plan_label');
  const percents = formData.getAll('plan_percent');
  return labels.map((label, i) => ({ label: String(label), percent: percents[i] }));
}

async function communeAllowList() {
  const hierarchy = await getLocationHierarchyWithFallback();
  return new Set([...(hierarchy.communes || []), ...Object.keys(KINSHASA_COMMUNE_CENTROIDS)]);
}

function revalidateProject(project) {
  forget('projects:');
  revalidatePath('/projets');
  revalidatePath('/listings');
  revalidatePath('/compte/agent/projets');
  if (project?.id) revalidatePath(`/compte/agent/projets/${project.id}/modifier`);
  if (project?.slug) revalidatePath(`/projets/${project.slug}`);
  if (project?.agent_id) revalidatePath(`/agents/${project.agent_id}`);
}

async function validatedInput(formData) {
  const input = { ...formObject(formData), payment_plan: planFromForm(formData) };
  const result = validateDevelopmentInput(input);
  if (result.errorKey) return result;
  if (result.value.commune && !(await communeAllowList()).has(result.value.commune)) {
    return { errorKey: 'admin.projects.errors.commune' };
  }
  return result;
}

function errorSuffix(key) {
  return key.replace('admin.projects.errors.', '');
}

export async function createProjectAction(formData) {
  const session = await requireAdmin('projects.manage');
  const result = await validatedInput(formData);
  if (result.errorKey) redirect(`/admin/projets/nouveau?error=${errorSuffix(result.errorKey)}`);
  const id = await createProject(result.value);
  await recordAudit(session, { action: 'projects.create', entityType: 'project', entityId: id, details: { name: result.value.name, kind: result.value.kind } });
  redirect(back(id, { saved: 'created' }));
}

export async function updateProjectAction(id, formData) {
  const session = await requireAdmin('projects.manage');
  const result = await validatedInput(formData);
  if (result.errorKey) redirect(back(id, { error: errorSuffix(result.errorKey) }));
  await updateProject(id, result.value);
  await recordAudit(session, { action: 'projects.update', entityType: 'project', entityId: id, details: { name: result.value.name } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(back(id, { saved: 'details' }));
}

export async function setPublishedAction(id, publish) {
  const session = await requireAdmin('projects.manage');
  const project = await getProjectForAdmin(id);
  if (!project) redirect('/admin/projets');
  if (publish) {
    const blockers = publishBlockers(project);
    if (blockers.length) redirect(back(id, { error: `publish_${blockers[0]}` }));
  }
  await setProjectPublished(id, publish, { moderatorId: session.id || null });
  await recordAudit(session, { action: publish ? 'projects.publish' : 'projects.unpublish', entityType: 'project', entityId: id });
  revalidateProject(project);
  if (publish && project.approve_status !== 1) {
    await tellDeveloper(project, [
      `🎉 Votre projet « ${project.name} » est en ligne sur Lukka Place.`,
      `https://lukkaplace.com/projets/${project.slug}`,
      '',
      'Gardez-le vivant : ajoutez une photo du chantier chaque mois et mettez à jour les unités vendues depuis votre tableau de bord.',
    ].join('\n'));
  }
  redirect(back(id, { saved: publish ? 'published' : 'unpublished' }));
}

export async function setVerifiedAction(id, formData) {
  const session = await requireAdmin('projects.manage');
  const verified = formData.get('verified') === '1';
  const note = String(formData.get('note') || '').trim().slice(0, 500);
  // The note is the stated basis — "permis vu, titre vérifié, visite le …".
  // A verification with no basis written down is not one.
  if (verified && note.length < 10) redirect(back(id, { error: 'verifyNote' }));
  await setProjectVerified(id, { verified, by: actorLabel(session).slice(0, 120), note });
  await recordAudit(session, { action: verified ? 'projects.verify' : 'projects.unverify', entityType: 'project', entityId: id, details: verified ? { note } : null });
  revalidateProject(await getProjectForAdmin(id));
  redirect(back(id, { saved: verified ? 'verified' : 'unverified' }));
}

export async function deleteProjectAction(id, formData) {
  const session = await requireAdmin('projects.manage');
  const project = await getProjectForAdmin(id);
  if (!project) redirect('/admin/projets');
  if (String(formData.get('confirm') || '') !== String(id)) redirect(back(id, { error: 'deleteConfirm' }));
  await deleteProject(id);
  await recordAudit(session, { action: 'projects.delete', entityType: 'project', entityId: id, details: { name: project.name } });
  revalidateProject(project);
  redirect('/admin/projets?saved=deleted');
}

async function uploadFiles(id, files) {
  const urls = [];
  for (const file of files.slice(0, MAX_FILES)) {
    if (!file || typeof file === 'string' || file.size === 0) continue;
    const ext = HERO_UPLOAD_TYPES[file.type];
    if (!ext) return { errorKey: 'badType' };
    if (file.size > HERO_MAX_UPLOAD_BYTES) return { errorKey: 'tooLarge' };
    urls.push(await uploadProjectImage(Buffer.from(await file.arrayBuffer()), id, ext));
  }
  return { urls };
}

export async function uploadImagesAction(id, field, formData) {
  const session = await requireAdmin('projects.manage');
  if (!['photos', 'renders'].includes(field)) redirect(back(id));
  let result;
  try {
    result = await uploadFiles(id, formData.getAll('images'));
  } catch (err) {
    console.error(`[admin/projets/${id}] upload failed: ${err.message}`);
    redirect(back(id, { error: 'upload' }));
  }
  if (result.errorKey) redirect(back(id, { error: result.errorKey }));
  await addProjectImages(id, field, result.urls);
  await recordAudit(session, { action: `projects.${field}.add`, entityType: 'project', entityId: id, details: { count: result.urls.length } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(back(id, { saved: field }));
}

export async function removeImageAction(id, field, url) {
  const session = await requireAdmin('projects.manage');
  await removeProjectImage(id, field, url);
  await recordAudit(session, { action: `projects.${field}.remove`, entityType: 'project', entityId: id });
  revalidateProject(await getProjectForAdmin(id));
  redirect(back(id, { saved: field }));
}

export async function uploadPlanAction(id, formData) {
  const session = await requireAdmin('projects.manage');
  let result;
  try {
    result = await uploadFiles(id, [formData.get('plan')]);
  } catch (err) {
    console.error(`[admin/projets/${id}] plan upload failed: ${err.message}`);
    redirect(back(id, { error: 'upload' }));
  }
  if (result.errorKey) redirect(back(id, { error: result.errorKey }));
  if (!result.urls.length) redirect(back(id));
  await setProjectPlanImage(id, result.urls[0]);
  await recordAudit(session, { action: 'projects.plan', entityType: 'project', entityId: id });
  revalidateProject(await getProjectForAdmin(id));
  redirect(back(id, { saved: 'plan' }));
}

export async function saveUnitTypeAction(id, unitId, formData) {
  const session = await requireAdmin('projects.manage');
  const result = validateUnitTypeInput(formObject(formData));
  if (result.errorKey) redirect(back(id, { error: errorSuffix(result.errorKey) }));
  await saveUnitType(id, unitId, result.value);
  await recordAudit(session, { action: unitId ? 'projects.unit.update' : 'projects.unit.create', entityType: 'project', entityId: id, details: { label: result.value.label } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(`${back(id, { saved: 'units' })}#types`);
}

export async function deleteUnitTypeAction(id, unitId) {
  const session = await requireAdmin('projects.manage');
  await deleteUnitType(id, unitId);
  await recordAudit(session, { action: 'projects.unit.delete', entityType: 'project', entityId: id, details: { unitId } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(`${back(id, { saved: 'units' })}#types`);
}

export async function saveLotAction(id, lotId, formData) {
  const session = await requireAdmin('projects.manage');
  const result = validateLotInput(formObject(formData));
  if (result.errorKey) redirect(`${back(id, { error: errorSuffix(result.errorKey) })}#lots`);
  await saveLot(id, lotId, result.value);
  await recordAudit(session, { action: lotId ? 'projects.lot.update' : 'projects.lot.create', entityType: 'project', entityId: id, details: { label: result.value.label, status: result.value.status } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(`${back(id, { saved: 'lots' })}#lots`);
}

export async function deleteLotAction(id, lotId) {
  const session = await requireAdmin('projects.manage');
  await deleteLot(id, lotId);
  await recordAudit(session, { action: 'projects.lot.delete', entityType: 'project', entityId: id, details: { lotId } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(`${back(id, { saved: 'lots' })}#lots`);
}

export async function addUpdateAction(id, formData) {
  const session = await requireAdmin('projects.manage');
  const takenOn = String(formData.get('taken_on') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn) || new Date(`${takenOn}T00:00:00Z`) > new Date()) {
    redirect(`${back(id, { error: 'updateDate' })}#chantier`);
  }
  const caption = String(formData.get('caption') || '').trim().slice(0, 500);
  let result;
  try {
    result = await uploadFiles(id, formData.getAll('images'));
  } catch (err) {
    console.error(`[admin/projets/${id}] update upload failed: ${err.message}`);
    redirect(`${back(id, { error: 'upload' })}#chantier`);
  }
  if (result.errorKey) redirect(`${back(id, { error: result.errorKey })}#chantier`);
  if (!caption && !result.urls.length) redirect(`${back(id, { error: 'updateEmpty' })}#chantier`);
  await addProjectUpdate(id, { takenOn, caption, photos: result.urls });
  await recordAudit(session, { action: 'projects.update.add', entityType: 'project', entityId: id, details: { takenOn, photos: result.urls.length } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(`${back(id, { saved: 'timeline' })}#chantier`);
}

export async function deleteUpdateAction(id, updateId) {
  const session = await requireAdmin('projects.manage');
  await deleteProjectUpdate(id, updateId);
  await recordAudit(session, { action: 'projects.update.delete', entityType: 'project', entityId: id, details: { updateId } });
  revalidateProject(await getProjectForAdmin(id));
  redirect(`${back(id, { saved: 'timeline' })}#chantier`);
}

/**
 * WhatsApp to the project's developer — only a verified, routing-enabled
 * number (agent_phone is NULL otherwise, in SQL: lib/developments.js
 * DEVELOPER_FIELDS). A session message: it reaches them only inside the 24h
 * window, so the dashboard banner is the record and this is the courtesy.
 */
async function tellDeveloper(project, message) {
  const phone = String(project.agent_phone || '').replace(/\D/g, '');
  if (!phone) return false;
  try {
    await sendWhatsAppMessage(phone, message);
    return true;
  } catch (err) {
    console.error(`[admin/projets/${project.id}] developer message failed: ${err.message}`);
    return false;
  }
}

/** Send the draft back with what to fix. The note shows in the developer's wizard. */
export async function requestChangesAction(id, formData) {
  const session = await requireAdmin('projects.manage');
  const project = await getProjectForAdmin(id);
  if (!project) redirect('/admin/projets');
  const note = String(formData.get('note') || '').trim().slice(0, 1000);
  if (note.length < 10) redirect(back(id, { error: 'reviewNote' }));
  await requestProjectChanges(id, { note, by: actorLabel(session).slice(0, 120) });
  await recordAudit(session, { action: 'projects.requestChanges', entityType: 'project', entityId: id, details: { length: note.length } });
  await tellDeveloper(project, [
    `Lukka Place — votre projet « ${project.name} » : quelques corrections avant publication.`,
    '',
    note,
    '',
    `https://lukkaplace.com/compte/agent/projets/${project.id}/modifier?step=apercu`,
  ].join('\n'));
  revalidateProject(project);
  redirect(back(id, { saved: 'changesRequested' }));
}

/** The team has looked at a live project's edits (and approves units added since). */
export async function acknowledgeChangesAction(id) {
  const session = await requireAdmin('projects.manage');
  const project = await getProjectForAdmin(id);
  if (!project) redirect('/admin/projets');
  await acknowledgeProjectChanges(id, { moderatorId: session.id || null });
  await recordAudit(session, { action: 'projects.acknowledge', entityType: 'project', entityId: id });
  revalidateProject(project);
  redirect(back(id, { saved: 'acknowledged' }));
}
