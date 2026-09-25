'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile } from '@/lib/agencies';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { uploadProjectImage } from '@/lib/listingStorage';
import { notifyOps } from '@/lib/adminApi';
import { forget } from '@/lib/memo';
import {
  addProjectImages, addProjectUpdate, agentSetLotStatus, agentSetUnitsAvailable, createProject,
  deleteLot, deleteOwnDraft, deleteUnitType, getAgentProject, getAgentProjects, insertLots, insertUnitTypes,
  markChangedIfLive, removeProjectImage, saveLot, saveUnitType, setProjectPlanImage, submitProject, updateProject,
} from '@/lib/developments';
import {
  LAND_MODES, LOT_STATUSES, WIZARD_STEPS, dateOnlyInputValue, generateLots, generateUnits, normalisePaymentPlan, pinWithinCommune,
  publishBlockers, validateDevelopmentInput, validateLotInput, validateUnitInput, validateUnitTypeInput,
} from '@/lib/developmentRules';
import { parsePastedRows } from '@/lib/projectPaste';
import { createUnitListings, deletePendingUnit, unitCreationBlocker } from '@/lib/projectUnits';
import { validatePhotoSelection } from '@/lib/uploadLimits.mjs';
import { getT } from '@/lib/i18n/server';

/**
 * The developer's side of /projets: the upload wizard, and the two numbers
 * they keep current (units left, lot status).
 *
 * Authority: the session's agent id, passed to lib/developments.js as
 * `{ agentId }`, which puts `agent_id = <session>` into every statement — a
 * crafted project, unit type or lot id changes zero rows. Nothing here takes
 * an owner from the form.
 *
 * Nothing a developer does publishes anything. A draft is approve_status 0
 * until the team approves it from /admin/projets; an edit to a project that
 * is already public goes live and raises `changes_pending` for the team.
 *
 * Most actions are plain form posts that redirect back to the step (works
 * without script; a refresh never re-submits). Image uploads are called
 * imperatively by a client component (photos are shrunk on the phone first)
 * and return { ok, error }.
 */

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_UNITS_PER_BATCH = 120;

async function requireAgent() {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  return agentId;
}

function stepHref(id, step, params = {}, hash = '') {
  const query = new URLSearchParams({ step, ...params }).toString();
  return `/compte/agent/projets/${id}/modifier?${query}${hash}`;
}

function errorSuffix(key) {
  return String(key || 'generic').replace('admin.projects.errors.', '');
}

function formObject(formData) {
  const value = {};
  for (const [key, entry] of formData.entries()) {
    if (typeof entry === 'string') value[key] = entry;
  }
  return value;
}

async function ownedProjectOr404(agentId, id) {
  const project = await getAgentProject(agentId, id);
  if (!project) redirect('/compte/agent/projets?error=notFound');
  return project;
}

function revalidateProject(project) {
  revalidatePath('/compte/agent/projets');
  revalidatePath(`/compte/agent/projets/${project.id}/modifier`);
  revalidatePath('/projets');
  if (project.slug) revalidatePath(`/projets/${project.slug}`);
  if (project.agent_id) revalidatePath(`/agents/${project.agent_id}`);
  forget('projects:');
}

/**
 * The project's current facts overlaid with this step's fields, validated as
 * a whole by the same validator the team's form uses — so a step can never
 * save something the admin form would refuse. Only the step's own columns are
 * then written.
 */
function mergedInput(project, fields) {
  return {
    name: project.name,
    kind: project.kind,
    stage: project.stage,
    purpose: project.purpose,
    delivery_expected: dateOnlyInputValue(project.delivery_expected),
    commune: project.commune,
    quartier: project.quartier,
    address: project.address,
    latitude: project.latitude ?? '',
    longitude: project.longitude ?? '',
    description: project.description,
    amenities: (project.amenities || []).join(', '),
    video_url: project.video_url,
    payment_plan: project.payment_plan,
    land_area_m2: project.land_area_m2 ?? '',
    land_title_status: project.land_title_status,
    land_mode: project.land_mode,
    ...fields,
  };
}

const STEP_COLUMNS = {
  etat: ['name', 'stage', 'purpose', 'delivery_expected', 'description', 'amenities', 'land_area_m2', 'land_title_status', 'land_mode'],
  lieu: ['commune', 'quartier', 'address', 'latitude', 'longitude'],
  video: ['video_url'],
  paiement: ['payment_plan'],
};

/** "2027-06" from a month input → the first of that month; a full date passes through. */
function monthToDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  return text;
}

async function communeAllowList() {
  const hierarchy = await getLocationHierarchyWithFallback();
  return new Set([...(hierarchy.communes || []), ...Object.keys(KINSHASA_COMMUNE_CENTROIDS)]);
}

// ---------------------------------------------------------------------------
// Start, steps, submit
// ---------------------------------------------------------------------------

/**
 * Step 0: what it is and what it is called. A verified phone is required —
 * the same bar as every other thing that carries an agent's name publicly.
 */
export async function createAgentProjectAction(formData) {
  const agentId = await requireAgent();
  const agent = await getAgentProfile(agentId);
  if (!agent?.phone_verified_at) redirect('/compte/agent/projets/nouveau?error=unverified');

  const type = String(formData.get('type') || '');
  const kind = type === 'building' ? 'building' : LAND_MODES.includes(type) ? 'land' : null;
  if (!kind) redirect('/compte/agent/projets/nouveau?error=kind');
  const result = validateDevelopmentInput({
    name: formData.get('name'),
    kind,
    stage: kind === 'building' ? 'under_construction' : null,
    land_mode: kind === 'land' ? type : null,
  });
  if (result.errorKey) redirect(`/compte/agent/projets/nouveau?error=${errorSuffix(result.errorKey)}&type=${encodeURIComponent(type)}`);

  const { value } = result;
  const id = await createProject({
    name: value.name,
    kind: value.kind,
    stage: value.stage,
    purpose: value.purpose,
    land_mode: value.land_mode,
    developer_name: agent.agency_name || null,
  }, { agentId });
  revalidatePath('/compte/agent/projets');
  redirect(stepHref(id, 'etat'));
}

/** Save one step's fields and go to the next step (or stay, with `stay=1`). */
export async function saveProjectStepAction(id, step, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const columns = STEP_COLUMNS[step];
  if (!columns) redirect(stepHref(id, 'etat'));

  const fields = formObject(formData);
  if (step === 'etat' && fields.delivery_expected !== undefined) fields.delivery_expected = monthToDate(fields.delivery_expected);
  if (step === 'paiement') {
    const labels = formData.getAll('plan_label');
    const percents = formData.getAll('plan_percent');
    fields.payment_plan = labels.map((label, i) => ({ label: String(label), percent: percents[i] }));
  }
  const pageStep = step === 'video' ? 'medias' : step;
  const result = validateDevelopmentInput(mergedInput(project, fields));
  if (result.errorKey) redirect(stepHref(id, pageStep, { error: errorSuffix(result.errorKey) }));

  const { value } = result;
  if (step === 'lieu') {
    if (value.commune && !(await communeAllowList()).has(value.commune)) {
      redirect(stepHref(id, pageStep, { error: 'commune' }));
    }
    const point = value.latitude !== null ? { lat: value.latitude, lng: value.longitude } : null;
    if (!pinWithinCommune(point, KINSHASA_COMMUNE_CENTROIDS[value.commune], value.commune)) {
      redirect(stepHref(id, pageStep, { error: 'pinFar' }));
    }
  }
  if (step === 'paiement' && value.payment_plan.length && !normalisePaymentPlan(value.payment_plan).complete) {
    redirect(stepHref(id, pageStep, { error: 'paymentPlan' }));
  }

  const patch = {};
  for (const column of columns) patch[column] = value[column];
  await updateProject(project.id, patch, { agentId });
  revalidateProject(project);

  if (formData.get('stay') === '1') redirect(stepHref(id, pageStep, { saved: step }));
  const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(pageStep) + 1] || 'apercu';
  redirect(stepHref(id, next));
}

/** Submit for review. Refused while publishBlockers says the page would be empty. */
export async function submitProjectAction(id) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const blockers = publishBlockers(project);
  if (blockers.length) redirect(stepHref(id, 'apercu', { error: `publish_${blockers[0]}` }));
  const submitted = await submitProject(agentId, project.id);
  if (!submitted) redirect(stepHref(id, 'apercu', { error: 'generic' }));
  const agent = await getAgentProfile(agentId);
  const who = agent?.agency_name || [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') || `Agent #${agentId}`;
  await notifyOps([
    '🏗️ Nouveau projet à valider',
    `${submitted.name} — ${who}`,
    `${project.kind === 'land' ? 'Terrain' : 'Immeuble'}${project.commune ? ` · ${project.commune}` : ''}`,
    `https://lukkaplace.com/admin/projets/${submitted.id}`,
  ].join('\n'));
  revalidateProject(project);
  redirect(stepHref(id, 'apercu', { saved: 'submitted' }));
}

export async function deleteDraftAction(id, formData) {
  const agentId = await requireAgent();
  if (String(formData.get('confirm') || '') !== 'SUPPRIMER') redirect(stepHref(id, 'apercu', { error: 'deleteConfirm' }));
  const ok = await deleteOwnDraft(agentId, id);
  if (!ok) redirect(stepHref(id, 'apercu', { error: 'deleteLive' }));
  revalidatePath('/compte/agent/projets');
  redirect('/compte/agent/projets?saved=deleted');
}

// ---------------------------------------------------------------------------
// Images (imperative: photos are shrunk on the phone, the component awaits)
// ---------------------------------------------------------------------------

async function uploadImages(projectId, files) {
  const problem = validatePhotoSelection(files, { allowedTypes: Object.keys(IMAGE_TYPES) });
  if (problem) return { problem };
  const urls = [];
  for (const file of files) {
    urls.push(await uploadProjectImage(Buffer.from(await file.arrayBuffer()), projectId, IMAGE_TYPES[file.type]));
  }
  return { urls };
}

/** `field`: photos | renders | plan. @returns {Promise<{ok: boolean, error?: string, count?: number}>} */
export async function uploadProjectImagesAction(id, field, formData) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.projects.wizard.sessionExpired') };
  if (!['photos', 'renders', 'plan'].includes(field)) return { ok: false, error: t('agent.projects.wizard.uploadFailed') };
  const project = await getAgentProject(agentId, id);
  if (!project) return { ok: false, error: t('agent.projects.wizard.uploadFailed') };

  const files = formData.getAll('images').filter((f) => f && typeof f !== 'string' && f.size > 0);
  if (!files.length) return { ok: false, error: t('agent.projects.wizard.noFile') };
  let result;
  try {
    result = await uploadImages(project.id, field === 'plan' ? files.slice(0, 1) : files);
  } catch (err) {
    console.error(`[agent/projets/${id}] upload failed: ${err.message}`);
    return { ok: false, error: t('agent.projects.wizard.uploadFailed') };
  }
  if (result.problem) return { ok: false, error: t(result.problem.key, result.problem.vars) };

  const ok = field === 'plan'
    ? await setProjectPlanImage(project.id, result.urls[0], { agentId })
    : await addProjectImages(project.id, field, result.urls, { agentId });
  if (!ok) return { ok: false, error: t('agent.projects.wizard.uploadFailed') };
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  return { ok: true, count: result.urls.length };
}

export async function removeProjectImageAction(id, field, url) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  await removeProjectImage(project.id, field, url, { agentId });
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'medias', { saved: 'media' }));
}

// ---------------------------------------------------------------------------
// The offer: unit types, individual units, portions, lots
// ---------------------------------------------------------------------------

export async function saveUnitTypeAction(id, unitId, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const result = validateUnitTypeInput(formObject(formData));
  if (result.errorKey) redirect(stepHref(id, 'offre', { error: errorSuffix(result.errorKey) }, '#types'));
  const ok = await saveUnitType(project.id, unitId, result.value, { agentId });
  if (!ok) redirect(stepHref(id, 'offre', { error: 'generic' }, '#types'));
  if (!unitId) await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'units' }, unitId ? `#type-${unitId}` : '#types'));
}

export async function deleteUnitTypeAction(id, unitId) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const ok = await deleteUnitType(project.id, unitId, { agentId });
  if (!ok) redirect(stepHref(id, 'offre', { error: 'typeHasUnits' }, '#types'));
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'units' }, '#types'));
}

/** "Coller depuis Excel" for unit types. The text is re-parsed here; the preview is not trusted. */
export async function importUnitTypesAction(id, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const purpose = formData.get('purpose') === 'rent' ? 'rent' : 'sale';
  const { rows } = parsePastedRows(formData.get('text'), 'unitTypes', { purpose, pricePeriod: formData.get('price_period') });
  const valid = rows.filter((r) => r.value).map((r, i) => ({ ...r.value, sort_order: (project.unit_types?.length || 0) + i }));
  const skipped = rows.length - valid.length;
  if (!valid.length) redirect(stepHref(id, 'offre', { error: 'pasteEmpty' }, '#types'));
  await insertUnitTypes(project.id, valid, { agentId });
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'imported', count: String(valid.length), skipped: String(skipped) }, '#types'));
}

async function createUnits(agentId, project, unitType, units) {
  const agent = await getAgentProfile(agentId);
  await createUnitListings({ project, unitType, units, agentId, vendorId: agent?.vendor_id || 0 });
  await markChangedIfLive(agentId, project.id);
  revalidatePath('/compte/agent/biens');
  revalidateProject(project);
}

function findType(project, unitTypeId) {
  return (project.unit_types || []).find((u) => String(u.id) === String(unitTypeId)) || null;
}

/** "Étages 1 à 5, 4 par étage" → that many listings, all at the same price (editable per unit in Mes biens). */
export async function generateUnitsAction(id, unitTypeId, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const unitType = findType(project, unitTypeId);
  const hash = `#type-${unitTypeId}`;
  if (!unitType) redirect(stepHref(id, 'offre', { error: 'generic' }, hash));
  const blocker = unitCreationBlocker(project, unitType);
  if (blocker) redirect(stepHref(id, 'offre', { error: `units_${blocker}` }, hash));

  const { units, truncated } = generateUnits({
    from: formData.get('from'),
    to: formData.get('to'),
    perFloor: formData.get('per_floor'),
    naming: formData.get('naming') === 'numbers' ? 'numbers' : 'letters',
    prefix: formData.get('prefix'),
  });
  if (truncated || units.length > MAX_UNITS_PER_BATCH) redirect(stepHref(id, 'offre', { error: 'tooManyUnits' }, hash));
  const existing = new Set((unitType.live_units || []).map((u) => String(u.unit_label || '').toLowerCase()));
  const fresh = units.filter((u) => !existing.has(u.label.toLowerCase()));
  const validated = fresh.map((u) => validateUnitInput({ ...u, price: formData.get('price') }, unitType));
  const bad = validated.find((r) => r.errorKey);
  if (bad) redirect(stepHref(id, 'offre', { error: errorSuffix(bad.errorKey) }, hash));
  if (!validated.length) redirect(stepHref(id, 'offre', { error: 'unitsExist' }, hash));

  try {
    await createUnits(agentId, project, unitType, validated.map((r) => r.value));
  } catch (err) {
    console.error(`[agent/projets/${id}] unit generation failed: ${err.message}`);
    redirect(stepHref(id, 'offre', { error: 'generic' }, hash));
  }
  redirect(stepHref(id, 'offre', { saved: 'unitsCreated', count: String(validated.length) }, hash));
}

/** Individual units pasted from a sheet: label, floor, price per line. */
export async function importUnitsAction(id, unitTypeId, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const unitType = findType(project, unitTypeId);
  const hash = `#type-${unitTypeId}`;
  if (!unitType) redirect(stepHref(id, 'offre', { error: 'generic' }, hash));
  const blocker = unitCreationBlocker(project, unitType);
  if (blocker) redirect(stepHref(id, 'offre', { error: `units_${blocker}` }, hash));
  const { rows, truncated } = parsePastedRows(formData.get('text'), 'units', { unitType });
  const existing = new Set((unitType.live_units || []).map((u) => String(u.unit_label || '').toLowerCase()));
  const valid = rows.filter((r) => r.value && !existing.has(r.value.label.toLowerCase())).map((r) => r.value);
  if (truncated || valid.length > MAX_UNITS_PER_BATCH) redirect(stepHref(id, 'offre', { error: 'tooManyUnits' }, hash));
  if (!valid.length) redirect(stepHref(id, 'offre', { error: 'pasteEmpty' }, hash));
  try {
    await createUnits(agentId, project, unitType, valid);
  } catch (err) {
    console.error(`[agent/projets/${id}] unit import failed: ${err.message}`);
    redirect(stepHref(id, 'offre', { error: 'generic' }, hash));
  }
  redirect(stepHref(id, 'offre', { saved: 'unitsCreated', count: String(valid.length), skipped: String(rows.length - valid.length) }, hash));
}

export async function deleteUnitAction(id, propertyId) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const ok = await deletePendingUnit(agentId, project.id, propertyId);
  revalidateProject(project);
  revalidatePath('/compte/agent/biens');
  redirect(stepHref(id, 'offre', ok ? { saved: 'unitDeleted' } : { error: 'unitLive' }, '#types'));
}

export async function saveLotAction(id, lotId, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const input = formObject(formData);
  // A portion's label is its share, so the table and the plan agree.
  if (project.land_mode === 'portions' && !input.label && input.share_percent) input.label = `${input.share_percent} %`;
  const result = validateLotInput(input);
  if (result.errorKey) redirect(stepHref(id, 'offre', { error: errorSuffix(result.errorKey) }, '#lots'));
  if (project.land_mode === 'portions' && result.value.share_percent === null) {
    redirect(stepHref(id, 'offre', { error: 'share' }, '#lots'));
  }
  const ok = await saveLot(project.id, lotId, result.value, { agentId });
  if (!ok) redirect(stepHref(id, 'offre', { error: 'generic' }, '#lots'));
  if (!lotId) await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'lots' }, lotId ? `#lot-${lotId}` : '#lots'));
}

export async function deleteLotAction(id, lotId) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  await deleteLot(project.id, lotId, { agentId });
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'lots' }, '#lots'));
}

/** "20 lots de 300 m² à 12 000 $" → Lot 1 … Lot 20. */
export async function generateLotsAction(id, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const start = (project.lots || []).length + 1;
  const lots = generateLots({
    count: formData.get('count'),
    start: formData.get('start') || start,
    area: formData.get('area_m2'),
    price: formData.get('price'),
    prefix: formData.get('prefix') ?? 'Lot ',
  });
  const existing = new Set((project.lots || []).map((l) => l.label.toLowerCase()));
  const fresh = lots.filter((l) => !existing.has(l.label.toLowerCase()));
  if (!fresh.length) redirect(stepHref(id, 'offre', { error: 'lotsExist' }, '#lots'));
  await insertLots(project.id, fresh, { agentId });
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'lotsCreated', count: String(fresh.length) }, '#lots'));
}

export async function importLotsAction(id, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  const { rows } = parsePastedRows(formData.get('text'), 'lots');
  const existing = new Set((project.lots || []).map((l) => l.label.toLowerCase()));
  const valid = rows.filter((r) => r.value && !existing.has(r.value.label.toLowerCase()))
    .map((r, i) => ({ ...r.value, sort_order: (project.lots?.length || 0) + i + 1 }));
  if (!valid.length) redirect(stepHref(id, 'offre', { error: 'pasteEmpty' }, '#lots'));
  await insertLots(project.id, valid, { agentId });
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'lotsCreated', count: String(valid.length), skipped: String(rows.length - valid.length) }, '#lots'));
}

/** The plan tracing is optional: "Lukka Place trace le plan pour moi" hands it to the team. */
export async function setTraceByTeamAction(id, formData) {
  const agentId = await requireAgent();
  const project = await ownedProjectOr404(agentId, id);
  await updateProject(project.id, { trace_by_team: formData.get('trace_by_team') === 'on' }, { agentId });
  revalidateProject(project);
  redirect(stepHref(id, 'offre', { saved: 'lots' }, '#plan'));
}

// ---------------------------------------------------------------------------
// Keeping it current: construction updates, units left, lot status
// ---------------------------------------------------------------------------

/**
 * A dated construction update from the phone. Live at once on a public
 * project (it is the developer's own dated photo, labelled with its date), and
 * the team is told through changes_pending so they can remove anything wrong.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function addConstructionUpdateAction(id, formData) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.projects.wizard.sessionExpired') };
  const project = await getAgentProject(agentId, id);
  if (!project) return { ok: false, error: t('agent.projects.wizard.uploadFailed') };

  const takenOn = String(formData.get('taken_on') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn) || new Date(`${takenOn}T00:00:00Z`) > new Date()) {
    return { ok: false, error: t('admin.projects.errors.updateDate') };
  }
  const caption = String(formData.get('caption') || '').trim().slice(0, 500);
  const files = formData.getAll('images').filter((f) => f && typeof f !== 'string' && f.size > 0);
  let urls = [];
  if (files.length) {
    try {
      const result = await uploadImages(project.id, files);
      if (result.problem) return { ok: false, error: t(result.problem.key, result.problem.vars) };
      urls = result.urls;
    } catch (err) {
      console.error(`[agent/projets/${id}] update upload failed: ${err.message}`);
      return { ok: false, error: t('agent.projects.wizard.uploadFailed') };
    }
  }
  if (!caption && !urls.length) return { ok: false, error: t('admin.projects.errors.updateEmpty') };
  const ok = await addProjectUpdate(project.id, { takenOn, caption, photos: urls }, { agentId });
  if (!ok) return { ok: false, error: t('agent.projects.wizard.uploadFailed') };
  await markChangedIfLive(agentId, project.id);
  revalidateProject(project);
  return { ok: true };
}

async function revalidateOwn(agentId) {
  const projects = await getAgentProjects(agentId).catch(() => []);
  revalidatePath('/projets');
  for (const p of projects) revalidatePath(`/projets/${p.slug}`);
  revalidatePath('/compte/agent/projets');
  forget('projects:');
}

function backTo(formData, fallback) {
  const target = String(formData.get('back') || '');
  return target.startsWith('/compte/agent/projets') ? target : fallback;
}

export async function setUnitsAvailableAction(unitId, formData) {
  const agentId = await requireAgent();
  const value = Number.parseInt(String(formData.get('units_available') ?? ''), 10);
  if (!Number.isFinite(value) || value < 0) redirect('/compte/agent/projets?error=units');
  const ok = await agentSetUnitsAvailable(agentId, unitId, value);
  if (!ok) redirect('/compte/agent/projets?error=units');
  await revalidateOwn(agentId);
  redirect(backTo(formData, '/compte/agent/projets?saved=1'));
}

export async function setLotStatusAction(lotId, formData) {
  const agentId = await requireAgent();
  const status = String(formData.get('status') || '');
  if (!LOT_STATUSES.includes(status)) redirect('/compte/agent/projets?error=lot');
  const ok = await agentSetLotStatus(agentId, lotId, status);
  if (!ok) redirect('/compte/agent/projets?error=lot');
  await revalidateOwn(agentId);
  redirect(backTo(formData, '/compte/agent/projets?saved=1'));
}
