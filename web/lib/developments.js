import 'server-only';
import { getPool } from './db';
import { AGENCY_NAME_EXPR, AGENT_INFOS_JOIN } from './listings';
import { KINSHASA_COMMUNE_CENTROIDS } from './geocoding';
import { memo } from './memo';
import {
  lotSummary, matchesProjectFilter, slugify, unitListingState, unitTypeSummary, withLiveUnitCounts,
} from './developmentRules';

/**
 * lib/developments.js — reads and writes for /projets and /admin/projets.
 *
 * THE PUBLIC GATE is the same two integers as `properties`, applied on every
 * public read, including the by-id lookup, so a guessed URL to an unpublished
 * project 404s:
 *     d.status = 1 AND d.approve_status = 1
 *
 * A missing table (42P01 — the migration not run yet) reads as "no projects",
 * so this can deploy before migrations/20260924_developments.sql.
 *
 * The developer's phone reaches a public payload only under the same rule
 * lib/listings.js applies to `agent_phone`: phone_verified_at set AND
 * direct_routing_enabled not false. Otherwise it is NULL in SQL and every CTA
 * falls back to the central number.
 */

export const PUBLIC_FILTER = 'd.status = 1 AND d.approve_status = 1';

const MISSING_TABLE = '42P01';
const MISSING_COLUMN = '42703';

// Must match lib/listings.js — property_contents' French row.
const CONTENT_LANGUAGE_ID = 20;

const DEVELOPER_JOIN = `
  LEFT JOIN agents a ON a.id = d.agent_id
  ${AGENT_INFOS_JOIN}`;

const DEVELOPER_FIELDS = `
  ${AGENCY_NAME_EXPR},
  CASE WHEN a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS NOT FALSE
       THEN a.phone END AS agent_phone,
  a.image AS agent_logo`;

async function safeQuery(sql, params = []) {
  try {
    return await getPool().query(sql, params);
  } catch (err) {
    if (err.code === MISSING_TABLE) return { rows: [], rowCount: 0, missing: true };
    throw err;
  }
}

/** Like safeQuery, and a column that does not exist yet (the migration not run) also reads as empty. */
async function lenientQuery(sql, params = []) {
  try {
    return await getPool().query(sql, params);
  } catch (err) {
    if (err.code === MISSING_TABLE || err.code === MISSING_COLUMN) return { rows: [], rowCount: 0, missing: true };
    throw err;
  }
}

/**
 * The individual units (real listings) of these projects, grouped by unit
 * type id. Every state is read — the public page counts from them and then
 * shows only what is public (see publicUnits); the developer sees them all.
 */
async function unitListings(ids) {
  if (!ids.length) return new Map();
  const { rows } = await lenientQuery(
    `SELECT p.id, p.development_id, p.development_unit_type_id, p.unit_label, p.unit_floor,
            p.price, p.purpose, p.price_period, p.beds, p.bath, p.area,
            p.status, p.approve_status, p.listing_status, pc.slug
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
     WHERE p.development_id = ANY($1::bigint[])
     ORDER BY p.unit_floor NULLS LAST, p.unit_label, p.id`,
    [ids],
  );
  const byType = new Map();
  for (const row of rows) {
    const key = String(row.development_unit_type_id ?? '');
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(row);
  }
  return byType;
}

/** What a visitor may see of a unit: available, reserved, or let/sold. Never pending or withdrawn. */
function publicUnits(units) {
  return units.filter((u) => ['available', 'reserved', 'taken'].includes(unitListingState(u)));
}

async function childRows(table, ids, order) {
  if (!ids.length) return new Map();
  const { rows } = await safeQuery(
    `SELECT * FROM ${table} WHERE development_id = ANY($1::bigint[]) ORDER BY ${order}`,
    [ids],
  );
  const byId = new Map(ids.map((id) => [String(id), []]));
  for (const row of rows) byId.get(String(row.development_id))?.push(row);
  return byId;
}

function withSummaries(project, rawUnitTypes, lots, units = new Map(), { isPublic = true } = {}) {
  const unitTypes = rawUnitTypes.map((type) => {
    const counted = withLiveUnitCounts(type, units.get(String(type.id)) || []);
    return isPublic ? { ...counted, live_units: publicUnits(counted.live_units) } : counted;
  });
  return {
    ...project,
    unit_types: unitTypes,
    lots,
    unit_summary: project.kind === 'building' ? unitTypeSummary(unitTypes) : null,
    lot_summary: project.kind === 'land' ? lotSummary(lots) : null,
  };
}

/** Where a project's pin goes: its own coordinates, else its commune's centroid (approximate). */
export function projectPosition(project) {
  const lat = Number(project.latitude);
  const lng = Number(project.longitude);
  if (project.latitude !== null && project.longitude !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, approximate: false };
  }
  const centroid = project.commune ? KINSHASA_COMMUNE_CENTROIDS[project.commune] : null;
  return centroid ? { lat: centroid.lat, lng: centroid.lng, approximate: true } : null;
}

/** The cover image: first real photo, else first render (the card labels which). */
export function projectCover(project) {
  const photo = (project.photos || []).find(Boolean);
  if (photo) return { src: photo, isRender: false };
  const render = (project.renders || []).find(Boolean);
  return render ? { src: render, isRender: true } : null;
}

/**
 * Every public project, with unit-type / lot summaries. Filtering by chip and
 * commune happens after the read — the table is small (tens of projects, not
 * thousands) and the chip rules live in developmentRules.js, one definition.
 */
export async function getPublicProjects({ filter = 'all', commune = null, agentId = null } = {}) {
  const params = [];
  let where = PUBLIC_FILTER;
  if (agentId) {
    params.push(agentId);
    where += ` AND d.agent_id = $${params.length}`;
  }
  const { rows } = await safeQuery(
    `SELECT d.*, ${DEVELOPER_FIELDS}
     FROM developments d
     ${DEVELOPER_JOIN}
     WHERE ${where}
     ORDER BY d.verified_at IS NULL, d.created_at DESC
     LIMIT 200`,
    params,
  );
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const [units, lots, listings] = await Promise.all([
    childRows('development_unit_types', ids, 'sort_order, id'),
    childRows('development_lots', ids, 'sort_order, id'),
    unitListings(ids),
  ]);

  return rows
    .map((row) => withSummaries(row, units.get(String(row.id)) || [], lots.get(String(row.id)) || [], listings))
    .filter((p) => matchesProjectFilter(p, filter))
    .filter((p) => !commune || p.commune === commune);
}

/** Communes that actually have a public project — the hub's commune filter offers nothing else. */
export async function getProjectCommunes() {
  const { rows } = await safeQuery(
    `SELECT d.commune, COUNT(*)::int AS count FROM developments d
     WHERE ${PUBLIC_FILTER} AND d.commune IS NOT NULL
     GROUP BY d.commune ORDER BY count DESC, d.commune`,
  );
  return rows;
}

/** One public project with everything its page shows, or null (absent OR unpublished). */
export async function getPublicProjectById(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const { rows } = await safeQuery(
    `SELECT d.*, ${DEVELOPER_FIELDS}
     FROM developments d
     ${DEVELOPER_JOIN}
     WHERE d.id = $1 AND ${PUBLIC_FILTER}`,
    [numericId],
  );
  if (!rows[0]) return null;
  return hydrateProject(rows[0]);
}

/**
 * A project with everything under it. `isPublic` (the default) keeps only the
 * units a visitor may see; the developer's and the team's views pass false.
 */
async function hydrateProject(row, { isPublic = true } = {}) {
  const [units, lots, updates, listings] = await Promise.all([
    childRows('development_unit_types', [row.id], 'sort_order, id'),
    childRows('development_lots', [row.id], 'sort_order, id'),
    childRows('development_updates', [row.id], 'taken_on DESC, id DESC'),
    unitListings([row.id]),
  ]);
  return {
    ...withSummaries(row, units.get(String(row.id)) || [], lots.get(String(row.id)) || [], listings, { isPublic }),
    updates: updates.get(String(row.id)) || [],
  };
}

/** Lightweight pins for the /projets map. */
export async function getProjectPins(options = {}) {
  const projects = await getPublicProjects(options);
  return projects
    .map((project) => {
      const position = projectPosition(project);
      if (!position) return null;
      const cover = projectCover(project);
      return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        kind: project.kind,
        stage: project.stage,
        commune: project.commune,
        verified: Boolean(project.verified_at),
        unit_summary: project.unit_summary,
        lot_summary: project.lot_summary,
        cover: cover?.src || null,
        coverIsRender: Boolean(cover?.isRender),
        ...position,
      };
    })
    .filter(Boolean);
}

/** Sitemap entries. */
export async function getSitemapProjects() {
  const { rows } = await safeQuery(
    `SELECT d.slug, d.updated_at FROM developments d WHERE ${PUBLIC_FILTER} ORDER BY d.id`,
  );
  return rows;
}


// ---------------------------------------------------------------------------
// Writes, for the team (/admin/projets) AND for developers (the wizard at
// /compte/agent/projets). One set of functions, two authority models, made
// explicit by `scope`:
//   scope = null            the team: any project (the caller has checked
//                           requireAdmin('projects.manage'));
//   scope = { agentId: n }  a developer: `agent_id = <session>` is IN the SQL
//                           of every statement, so a crafted id changes zero
//                           rows. Never taken from a form.
// ---------------------------------------------------------------------------

/** `AND agent_id = $n` on a developments statement, or nothing for the team. */
function ownerOnDevelopment(scope, params, column = 'agent_id') {
  if (!scope) return '';
  if (!scope.agentId) throw new Error('developer scope without an agent id');
  params.push(scope.agentId);
  return ` AND ${column} = $${params.length}`;
}

/** The same rule for a child row (unit type, lot, update): its project must be the developer's. */
function ownerOnChild(scope, params, devParam) {
  if (!scope) return '';
  if (!scope.agentId) throw new Error('developer scope without an agent id');
  params.push(scope.agentId);
  return ` AND EXISTS (SELECT 1 FROM developments d WHERE d.id = ${devParam} AND d.agent_id = $${params.length})`;
}

/** The review queue first (submitted, oldest first), then edited live projects, then everything else. */
export async function listProjectsForAdmin() {
  const { rows, missing } = await safeQuery(
    `SELECT d.*, ${DEVELOPER_FIELDS},
            (SELECT COUNT(*)::int FROM development_unit_types u WHERE u.development_id = d.id) AS unit_type_count,
            (SELECT COUNT(*)::int FROM development_lots l WHERE l.development_id = d.id) AS lot_count,
            (SELECT MAX(taken_on) FROM development_updates up WHERE up.development_id = d.id) AS last_update_on
     FROM developments d
     ${DEVELOPER_JOIN}
     ORDER BY d.created_at DESC`,
  );
  return { projects: rows, missing: Boolean(missing) };
}

/**
 * Projects waiting for the team: submitted and not answered since, or live
 * with edits nobody has looked at. The sidebar badge counts these.
 */
export async function countProjectReviewQueue() {
  const { rows } = await lenientQuery(
    `SELECT COUNT(*)::int AS n FROM developments d
     WHERE (d.approve_status = 0 AND d.submitted_at IS NOT NULL
            AND (d.reviewed_at IS NULL OR d.reviewed_at < d.submitted_at))
        OR (d.approve_status = 1 AND d.changes_pending)`,
  );
  return rows[0]?.n ?? 0;
}

export async function getProjectForAdmin(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return null;
  const { rows } = await safeQuery(
    `SELECT d.*, ${DEVELOPER_FIELDS} FROM developments d ${DEVELOPER_JOIN} WHERE d.id = $1`,
    [numericId],
  );
  return rows[0] ? hydrateProject(rows[0], { isPublic: false }) : null;
}

/** One of this developer's own projects, in any state, or null. */
export async function getAgentProject(agentId, id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId) || !agentId) return null;
  const { rows } = await safeQuery(
    `SELECT d.*, ${DEVELOPER_FIELDS} FROM developments d ${DEVELOPER_JOIN} WHERE d.id = $1 AND d.agent_id = $2`,
    [numericId, agentId],
  );
  return rows[0] ? hydrateProject(rows[0], { isPublic: false }) : null;
}

const PROJECT_COLUMNS = [
  'name', 'kind', 'stage', 'purpose', 'delivery_expected', 'agent_id', 'developer_name',
  'commune', 'quartier', 'address', 'latitude', 'longitude', 'description', 'amenities',
  'video_url', 'payment_plan', 'land_area_m2', 'land_title_status', 'land_mode', 'trace_by_team',
];

/** Columns a developer may never set: who owns the project is the session, not the form. */
const TEAM_ONLY_COLUMNS = new Set(['agent_id']);

function columnValue(column, value) {
  return column === 'payment_plan' ? JSON.stringify(value ?? []) : value;
}

function writableColumns(value, scope) {
  return PROJECT_COLUMNS.filter((c) => value[c] !== undefined && !(scope && TEAM_ONLY_COLUMNS.has(c)));
}

/**
 * Create a draft (approve_status 0). The slug carries the id, so it is set
 * after the insert. A developer's draft is theirs by construction: agent_id
 * is the session's, and created_by_agent records who started it.
 */
export async function createProject(value, scope = null) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const cols = writableColumns(value, scope);
    const values = cols.map((c) => columnValue(c, value[c]));
    if (scope) {
      cols.push('agent_id', 'created_by_agent');
      values.push(scope.agentId, true);
    }
    const { rows } = await client.query(
      `INSERT INTO developments (slug, ${cols.join(', ')})
       VALUES ('pending-' || md5(random()::text), ${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      values,
    );
    const id = rows[0].id;
    await client.query('UPDATE developments SET slug = $1 WHERE id = $2', [`${slugify(value.name)}-${id}`, id]);
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** @returns {Promise<boolean>} false when nothing matched (not theirs, or gone). */
export async function updateProject(id, value, scope = null) {
  const cols = writableColumns(value, scope);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  const params = [id, ...cols.map((c) => columnValue(c, value[c]))];
  // A rename re-slugs; the trailing id keeps every old link resolving
  // (the page looks the project up by id and redirects to the current slug).
  if (value.name) {
    params.push(`${slugify(value.name)}-${id}`);
    sets.push(`slug = $${params.length}`);
  }
  // A developer editing a PUBLIC project: the page stays up, the team is told.
  if (scope) sets.push('changes_pending = changes_pending OR approve_status = 1');
  if (!sets.length) return true;
  const { rowCount } = await getPool().query(
    `UPDATE developments SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1${ownerOnDevelopment(scope, params)}`,
    params,
  );
  return rowCount > 0;
}

/**
 * The team publishes (or takes down) a project — and its units with it.
 *
 * Publishing approves, in the same transaction, every unit listing of the
 * project still pending (approve_status 0): the team reviewed the unit types
 * those units were generated from, and a building whose page is live while
 * its units wait in another queue would say "6 disponibles" and link to
 * nothing. Rejected units (2) are left alone. Taking the project down puts
 * its approved units back to pending, so a hidden project never leaves its
 * units on the listings map; publishing again brings them back.
 */
export async function setProjectPublished(id, published, { moderatorId = null } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      published
        ? `UPDATE developments SET approve_status = 1, status = 1, approved_at = COALESCE(approved_at, NOW()),
                  reviewed_at = NOW(), review_note = NULL, changes_pending = false, updated_at = NOW()
           WHERE id = $1`
        : `UPDATE developments SET approve_status = 0, status = 1, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    // A let/sold unit keeps its approval when the project is taken down: it is
    // the achieved-price record the market export reads (approve_status = 1
    // only), and it is not on the map anyway (status = 0).
    await client.query(
      `UPDATE properties SET approve_status = $2, moderated_at = NOW(), moderated_by = $3,
              moderation_reason_code = NULL, moderation_note = $4, updated_at = NOW()
       WHERE development_id = $1 AND approve_status = $5
         ${published ? '' : "AND COALESCE(listing_status, 'active') <> 'closed'"}`,
      published ? [id, 1, moderatorId, `projet #${id}`, 0] : [id, 0, moderatorId, `projet #${id} retiré`, 1],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === MISSING_COLUMN) {
      // Before migrations/20260925_developer_self_serve.sql: no units, no review columns.
      await getPool().query(
        'UPDATE developments SET approve_status = $2, status = 1, updated_at = NOW() WHERE id = $1',
        [id, published ? 1 : 0],
      );
      return;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The team has looked at a live project's edits: clears the flag and approves
 * any unit listings added since (same reasoning as setProjectPublished).
 */
export async function acknowledgeProjectChanges(id, { moderatorId = null } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE developments SET changes_pending = false, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND approve_status = 1`,
      [id],
    );
    await client.query(
      `UPDATE properties SET approve_status = 1, moderated_at = NOW(), moderated_by = $2,
              moderation_note = $3, updated_at = NOW()
       WHERE development_id = $1 AND approve_status = 0
         AND EXISTS (SELECT 1 FROM developments d WHERE d.id = $1 AND d.approve_status = 1)`,
      [id, moderatorId, `projet #${id}`],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The team asks the developer for changes. The note is shown in their wizard
 * (and sent on WhatsApp by the caller). An unpublished project stays a draft;
 * a live one stays live.
 */
export async function requestProjectChanges(id, { note, by }) {
  await getPool().query(
    `UPDATE developments SET review_note = $2, reviewed_at = NOW(), reviewed_by = $3, updated_at = NOW() WHERE id = $1`,
    [id, note, by],
  );
}

/**
 * The developer submits their draft for review. Only an unpublished project
 * of theirs; a resubmission after a change request clears nothing — the old
 * note stays readable and projectReviewState compares the two dates.
 * @returns {Promise<Object|null>} the project's id and name, or null.
 */
export async function submitProject(agentId, id) {
  const { rows } = await getPool().query(
    `UPDATE developments SET submitted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND agent_id = $2 AND approve_status = 0
     RETURNING id, name, slug`,
    [id, agentId],
  );
  return rows[0] || null;
}

/** A developer changed something visible on a public project (images, units, lots): tell the team. */
export async function markChangedIfLive(agentId, id) {
  await lenientQuery(
    `UPDATE developments SET changes_pending = true, updated_at = NOW()
     WHERE id = $1 AND agent_id = $2 AND approve_status = 1`,
    [id, agentId],
  );
}

/** Verification is a human act with a stated basis; clearing it clears the note too. */
export async function setProjectVerified(id, { verified, by, note }) {
  await getPool().query(
    verified
      ? `UPDATE developments SET verified_at = NOW(), verified_by = $2, verification_note = $3, updated_at = NOW() WHERE id = $1`
      : `UPDATE developments SET verified_at = NULL, verified_by = NULL, verification_note = NULL, updated_at = NOW() WHERE id = $1`,
    verified ? [id, by, note] : [id],
  );
}

/**
 * Team only. A project's unit listings survive it (ON DELETE SET NULL): they
 * are real listings the team may have approved; they keep their building id,
 * so they still share one pin.
 */
export async function deleteProject(id) {
  await getPool().query('DELETE FROM developments WHERE id = $1', [id]);
}

/** A developer deletes their own draft — never a project that has been public. */
export async function deleteOwnDraft(agentId, id) {
  const { rowCount } = await getPool().query(
    `DELETE FROM developments d WHERE d.id = $1 AND d.agent_id = $2 AND d.approve_status = 0
       AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.development_id = d.id AND p.approve_status = 1)`,
    [id, agentId],
  );
  return rowCount > 0;
}

/** Append images to `photos` or `renders`. */
export async function addProjectImages(id, field, urls, scope = null) {
  if (!['photos', 'renders'].includes(field) || !urls.length) return false;
  const params = [id, urls];
  const { rowCount } = await getPool().query(
    `UPDATE developments SET ${field} = ${field} || $2::text[], updated_at = NOW() WHERE id = $1${ownerOnDevelopment(scope, params)}`,
    params,
  );
  return rowCount > 0;
}

export async function removeProjectImage(id, field, url, scope = null) {
  if (!['photos', 'renders'].includes(field)) return false;
  const params = [id, url];
  const { rowCount } = await getPool().query(
    `UPDATE developments SET ${field} = array_remove(${field}, $2), updated_at = NOW() WHERE id = $1${ownerOnDevelopment(scope, params)}`,
    params,
  );
  return rowCount > 0;
}

export async function setProjectPlanImage(id, url, scope = null) {
  const params = [id, url];
  const { rowCount } = await getPool().query(
    `UPDATE developments SET plan_image = $2, updated_at = NOW() WHERE id = $1${ownerOnDevelopment(scope, params)}`,
    params,
  );
  return rowCount > 0;
}

const UNIT_COLUMNS = [
  'label', 'purpose', 'bedrooms', 'bathrooms', 'area_m2', 'price_min', 'price_max',
  'price_period', 'units_total', 'units_available', 'sort_order', 'category_id', 'ready_now',
];

// A multi-row VALUES list has no target column to infer types from, so each
// parameter is cast to its column's type.
const UNIT_CASTS = {
  label: 'text', purpose: 'text', bedrooms: 'int', bathrooms: 'int', area_m2: 'numeric',
  price_min: 'numeric', price_max: 'numeric', price_period: 'text', units_total: 'int',
  units_available: 'int', sort_order: 'int', category_id: 'bigint', ready_now: 'boolean',
};
const LOT_CASTS = {
  label: 'text', status: 'text', area_m2: 'numeric', price: 'numeric', share_percent: 'numeric',
  title_status: 'text', polygon: 'jsonb', sort_order: 'int',
};

export async function saveUnitType(developmentId, unitId, value, scope = null) {
  if (unitId) {
    const params = [unitId, developmentId, ...UNIT_COLUMNS.map((c) => value[c] ?? (c === 'ready_now' ? false : null))];
    const { rowCount } = await getPool().query(
      `UPDATE development_unit_types SET ${UNIT_COLUMNS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND development_id = $2${ownerOnChild(scope, params, '$2')}`,
      params,
    );
    return rowCount > 0;
  }
  return (await insertUnitTypes(developmentId, [value], scope)) > 0;
}

/** Several unit types at once (the pasted table). All or nothing. @returns rows inserted */
export async function insertUnitTypes(developmentId, values, scope = null) {
  if (!values.length) return 0;
  const params = [developmentId];
  const tuples = values.map((value) => {
    const start = params.length;
    for (const c of UNIT_COLUMNS) params.push(value[c] ?? (c === 'ready_now' ? false : c === 'sort_order' ? 0 : null));
    return `($1::bigint, ${UNIT_COLUMNS.map((c, i) => `$${start + i + 1}::${UNIT_CASTS[c]}`).join(', ')})`;
  });
  const guard = ownerOnChild(scope, params, '$1');
  const { rowCount } = await getPool().query(
    `INSERT INTO development_unit_types (development_id, ${UNIT_COLUMNS.join(', ')})
     SELECT v.* FROM (VALUES ${tuples.join(', ')}) AS v(development_id, ${UNIT_COLUMNS.join(', ')})
     WHERE EXISTS (SELECT 1 FROM developments WHERE id = $1)${guard}`,
    params,
  );
  return rowCount;
}

/** A unit type with individual units cannot be deleted from under them — close or delete the units first. */
export async function deleteUnitType(developmentId, unitId, scope = null) {
  const params = [unitId, developmentId];
  const { rowCount } = await lenientQuery(
    `DELETE FROM development_unit_types u WHERE u.id = $1 AND u.development_id = $2
       AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.development_unit_type_id = u.id)${ownerOnChild(scope, params, '$2')}`,
    params,
  );
  return rowCount > 0;
}

const LOT_COLUMNS = ['label', 'status', 'area_m2', 'price', 'share_percent', 'title_status', 'polygon', 'sort_order'];

function lotValue(column, value) {
  if (column === 'polygon') return value.polygon ? JSON.stringify(value.polygon) : null;
  if (column === 'status') return value.status || 'available';
  if (column === 'sort_order') return value.sort_order ?? 0;
  return value[column] ?? null;
}

export async function saveLot(developmentId, lotId, value, scope = null) {
  if (lotId) {
    const params = [lotId, developmentId, ...LOT_COLUMNS.map((c) => lotValue(c, value))];
    const { rowCount } = await getPool().query(
      `UPDATE development_lots SET ${LOT_COLUMNS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND development_id = $2${ownerOnChild(scope, params, '$2')}`,
      params,
    );
    return rowCount > 0;
  }
  return (await insertLots(developmentId, [value], scope)) > 0;
}

/** Several lots at once (the generator, the pasted table). All or nothing. @returns rows inserted */
export async function insertLots(developmentId, values, scope = null) {
  if (!values.length) return 0;
  const params = [developmentId];
  const tuples = values.map((value) => {
    const start = params.length;
    for (const c of LOT_COLUMNS) params.push(lotValue(c, value));
    return `($1::bigint, ${LOT_COLUMNS.map((c, i) => `$${start + i + 1}::${LOT_CASTS[c]}`).join(', ')})`;
  });
  const guard = ownerOnChild(scope, params, '$1');
  const { rowCount } = await getPool().query(
    `INSERT INTO development_lots (development_id, ${LOT_COLUMNS.join(', ')})
     SELECT v.* FROM (VALUES ${tuples.join(', ')}) AS v(development_id, ${LOT_COLUMNS.join(', ')})
     WHERE EXISTS (SELECT 1 FROM developments WHERE id = $1)${guard}`,
    params,
  );
  return rowCount;
}

export async function deleteLot(developmentId, lotId, scope = null) {
  const params = [lotId, developmentId];
  const { rowCount } = await getPool().query(
    `DELETE FROM development_lots WHERE id = $1 AND development_id = $2${ownerOnChild(scope, params, '$2')}`,
    params,
  );
  return rowCount > 0;
}

/** A dated construction update. A developer's goes live at once on a public project; the team is told by the caller. */
export async function addProjectUpdate(developmentId, { takenOn, caption, photos }, scope = null) {
  const params = [developmentId, takenOn, caption || null, photos];
  const guard = ownerOnChild(scope, params, '$1');
  const { rowCount } = await getPool().query(
    `INSERT INTO development_updates (development_id, taken_on, caption, photos)
     SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM developments WHERE id = $1)${guard}`,
    params,
  );
  if (rowCount) await getPool().query('UPDATE developments SET updated_at = NOW() WHERE id = $1', [developmentId]);
  return rowCount > 0;
}

export async function deleteProjectUpdate(developmentId, updateId, scope = null) {
  const params = [updateId, developmentId];
  const { rowCount } = await getPool().query(
    `DELETE FROM development_updates WHERE id = $1 AND development_id = $2${ownerOnChild(scope, params, '$2')}`,
    params,
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Developer (agent portal): their own projects in any state.
// ---------------------------------------------------------------------------

export async function getAgentProjects(agentId) {
  const { rows } = await safeQuery(
    `SELECT d.* FROM developments d WHERE d.agent_id = $1 ORDER BY d.created_at DESC`,
    [agentId],
  );
  return Promise.all(rows.map((row) => hydrateProject(row, { isPublic: false })));
}

export async function agentSetUnitsAvailable(agentId, unitId, available) {
  const { rowCount } = await getPool().query(
    `UPDATE development_unit_types u SET units_available = $3, updated_at = NOW()
     FROM developments d
     WHERE u.id = $2 AND u.development_id = d.id AND d.agent_id = $1
       AND (u.units_total IS NULL OR $3 <= u.units_total)`,
    [agentId, unitId, available],
  );
  return rowCount > 0;
}

export async function agentSetLotStatus(agentId, lotId, status) {
  const { rowCount } = await getPool().query(
    `UPDATE development_lots l SET status = $3, updated_at = NOW()
     FROM developments d
     WHERE l.id = $2 AND l.development_id = d.id AND d.agent_id = $1`,
    [agentId, lotId, status],
  );
  return rowCount > 0;
}

export async function agentOwnsProject(agentId, developmentId) {
  const { rows } = await safeQuery('SELECT 1 FROM developments WHERE id = $1 AND agent_id = $2', [developmentId, agentId]);
  return rows.length > 0;
}

/**
 * Public projects within a map box — the /listings map's "N projets neufs
 * ici" chip. Only a count and the box's projects' ids; the chip opens /projets.
 * Commune-centroid projects count where their centroid is.
 */
export async function countProjectsInBounds(bounds) {
  // Asked on every settled /listings map view: the pins (tens of projects)
  // are read once a minute, not once per pan.
  const pins = await memo('projects:pins', 60_000, () => getProjectPins());
  return pins.filter((p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east).length;
}

/** The homepage strip: recently approved or updated public projects, newest first. */
export async function getRecentProjects(limit = 6) {
  const projects = await getPublicProjects({});
  return projects
    .sort((a, b) => new Date(b.approved_at || b.updated_at || b.created_at) - new Date(a.approved_at || a.updated_at || a.created_at))
    .slice(0, limit);
}
