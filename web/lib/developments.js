import 'server-only';
import { getPool } from './db';
import { AGENCY_NAME_EXPR, AGENT_INFOS_JOIN } from './listings';
import { KINSHASA_COMMUNE_CENTROIDS } from './geocoding';
import {
  lotSummary, matchesProjectFilter, slugify, unitTypeSummary,
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

function withSummaries(project, unitTypes, lots) {
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
  const [units, lots] = await Promise.all([
    childRows('development_unit_types', ids, 'sort_order, id'),
    childRows('development_lots', ids, 'sort_order, id'),
  ]);

  return rows
    .map((row) => withSummaries(row, units.get(String(row.id)) || [], lots.get(String(row.id)) || []))
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

async function hydrateProject(row) {
  const [units, lots, updates] = await Promise.all([
    childRows('development_unit_types', [row.id], 'sort_order, id'),
    childRows('development_lots', [row.id], 'sort_order, id'),
    childRows('development_updates', [row.id], 'taken_on DESC, id DESC'),
  ]);
  return {
    ...withSummaries(row, units.get(String(row.id)) || [], lots.get(String(row.id)) || []),
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
// Admin (/admin/projets) — no public gate: the team sees drafts too.
// ---------------------------------------------------------------------------

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

export async function getProjectForAdmin(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return null;
  const { rows } = await safeQuery(
    `SELECT d.*, ${DEVELOPER_FIELDS} FROM developments d ${DEVELOPER_JOIN} WHERE d.id = $1`,
    [numericId],
  );
  return rows[0] ? hydrateProject(rows[0]) : null;
}

const PROJECT_COLUMNS = [
  'name', 'kind', 'stage', 'purpose', 'delivery_expected', 'agent_id', 'developer_name',
  'commune', 'quartier', 'address', 'latitude', 'longitude', 'description', 'amenities',
  'video_url', 'payment_plan', 'land_area_m2', 'land_title_status',
];

function columnValue(column, value) {
  return column === 'payment_plan' ? JSON.stringify(value ?? []) : value;
}

/** Create a draft (approve_status 0). The slug carries the id, so it is set after the insert. */
export async function createProject(value) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const cols = PROJECT_COLUMNS.filter((c) => value[c] !== undefined);
    const { rows } = await client.query(
      `INSERT INTO developments (slug, ${cols.join(', ')})
       VALUES ('pending-' || md5(random()::text), ${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      cols.map((c) => columnValue(c, value[c])),
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

export async function updateProject(id, value) {
  const cols = PROJECT_COLUMNS.filter((c) => value[c] !== undefined);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  // A rename re-slugs; the trailing id keeps every old link resolving
  // (the page looks the project up by id and redirects to the current slug).
  if (value.name) sets.push(`slug = $${cols.length + 2}`);
  const params = [id, ...cols.map((c) => columnValue(c, value[c]))];
  if (value.name) params.push(`${slugify(value.name)}-${id}`);
  await getPool().query(
    `UPDATE developments SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    params,
  );
}

export async function setProjectPublished(id, published) {
  await getPool().query(
    `UPDATE developments SET approve_status = $2, status = 1, updated_at = NOW() WHERE id = $1`,
    [id, published ? 1 : 0],
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

export async function deleteProject(id) {
  await getPool().query('DELETE FROM developments WHERE id = $1', [id]);
}

/** Append images to `photos` or `renders`. */
export async function addProjectImages(id, field, urls) {
  if (!['photos', 'renders'].includes(field) || !urls.length) return;
  await getPool().query(
    `UPDATE developments SET ${field} = ${field} || $2::text[], updated_at = NOW() WHERE id = $1`,
    [id, urls],
  );
}

export async function removeProjectImage(id, field, url) {
  if (!['photos', 'renders'].includes(field)) return;
  await getPool().query(
    `UPDATE developments SET ${field} = array_remove(${field}, $2), updated_at = NOW() WHERE id = $1`,
    [id, url],
  );
}

export async function setProjectPlanImage(id, url) {
  await getPool().query('UPDATE developments SET plan_image = $2, updated_at = NOW() WHERE id = $1', [id, url]);
}

const UNIT_COLUMNS = [
  'label', 'purpose', 'bedrooms', 'bathrooms', 'area_m2', 'price_min', 'price_max',
  'price_period', 'units_total', 'units_available', 'sort_order',
];

export async function saveUnitType(developmentId, unitId, value) {
  if (unitId) {
    await getPool().query(
      `UPDATE development_unit_types SET ${UNIT_COLUMNS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND development_id = $2`,
      [unitId, developmentId, ...UNIT_COLUMNS.map((c) => value[c])],
    );
    return;
  }
  await getPool().query(
    `INSERT INTO development_unit_types (development_id, ${UNIT_COLUMNS.join(', ')})
     VALUES ($1, ${UNIT_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`,
    [developmentId, ...UNIT_COLUMNS.map((c) => value[c])],
  );
}

export async function deleteUnitType(developmentId, unitId) {
  await getPool().query('DELETE FROM development_unit_types WHERE id = $1 AND development_id = $2', [unitId, developmentId]);
}

const LOT_COLUMNS = ['label', 'status', 'area_m2', 'price', 'share_percent', 'title_status', 'polygon', 'sort_order'];

function lotValue(column, value) {
  return column === 'polygon' ? (value[column] ? JSON.stringify(value[column]) : null) : value[column];
}

export async function saveLot(developmentId, lotId, value) {
  if (lotId) {
    await getPool().query(
      `UPDATE development_lots SET ${LOT_COLUMNS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND development_id = $2`,
      [lotId, developmentId, ...LOT_COLUMNS.map((c) => lotValue(c, value))],
    );
    return;
  }
  await getPool().query(
    `INSERT INTO development_lots (development_id, ${LOT_COLUMNS.join(', ')})
     VALUES ($1, ${LOT_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`,
    [developmentId, ...LOT_COLUMNS.map((c) => lotValue(c, value))],
  );
}

export async function deleteLot(developmentId, lotId) {
  await getPool().query('DELETE FROM development_lots WHERE id = $1 AND development_id = $2', [lotId, developmentId]);
}

export async function addProjectUpdate(developmentId, { takenOn, caption, photos }) {
  await getPool().query(
    `INSERT INTO development_updates (development_id, taken_on, caption, photos) VALUES ($1, $2, $3, $4)`,
    [developmentId, takenOn, caption || null, photos],
  );
  await getPool().query('UPDATE developments SET updated_at = NOW() WHERE id = $1', [developmentId]);
}

export async function deleteProjectUpdate(developmentId, updateId) {
  await getPool().query('DELETE FROM development_updates WHERE id = $1 AND development_id = $2', [updateId, developmentId]);
}

// ---------------------------------------------------------------------------
// Developer (agent portal): their own projects, published or not, and the two
// facts they keep current themselves — units left and lot status. Every write
// is scoped by agent_id in SQL, so a crafted id changes zero rows.
// ---------------------------------------------------------------------------

export async function getAgentProjects(agentId) {
  const { rows } = await safeQuery(
    `SELECT d.* FROM developments d WHERE d.agent_id = $1 ORDER BY d.created_at DESC`,
    [agentId],
  );
  return Promise.all(rows.map(hydrateProject));
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
