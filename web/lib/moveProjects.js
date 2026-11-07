import 'server-only';
import { cache } from 'react';
import { getPool } from './db';
import { addSavedSearch } from './customers';
import { buildSearchLabel } from './searchLabel';
import { MAX_MOVE_PROJECTS, moveSearchQuery } from './moveProjectRules';

/**
 * customer_move_projects — up to MAX_MOVE_PROJECTS (5) per customer since
 * migrations/20261107_move_projects_multiple.sql (owner, 2026-11-07). Rules
 * and shapes: lib/moveProjectRules.js.
 *
 * Every statement is scoped `customer_id = $1` from the session — a project
 * id alone never reaches another customer's row.
 *
 * Survives running before its migrations:
 *  - no table (42P01): no projects; writes report `saved: false`;
 *  - before the multiple-projects migration (no `id` / `title`, 42703): one
 *    project per customer, addressed as id 0, saved with the old upsert;
 *  - before the budget_min migration: saved without the lower budget end.
 * Signup never fails over any of it (saveProjectAndAlert never throws).
 */

const MISSING_TABLE = '42P01';
const MISSING_COLUMN = '42703';
/** The id a pre-migration (one-per-customer) row is addressed by. */
export const LEGACY_PROJECT_ID = 0;

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id != null ? Number(row.id) : LEGACY_PROJECT_ID,
    title: row.title ?? null,
    reasons: row.reasons || [],
    reasonOther: row.reason_other,
    transactionType: row.transaction_type,
    leaseTerm: row.lease_term,
    household: row.household,
    bedroomsMin: row.bedrooms_min,
    anchorKind: row.anchor_kind,
    anchorCommune: row.anchor_commune,
    anchorNote: row.anchor_note,
    city: row.city,
    communes: row.communes || [],
    priorities: row.priorities || [],
    budgetMin: row.budget_min ?? null,
    budgetMax: row.budget_max,
    timeline: row.timeline,
    currentHomeType: row.current_home_type,
    currentCommune: row.current_commune,
    answeredSteps: row.answered_steps || [],
    lastLeadId: row.last_lead_id != null ? Number(row.last_lead_id) : null,
    lastLeadAt: row.last_lead_at,
    // migrations/20261107_move_project_journey.sql — absent (undefined) before it runs.
    status: row.status || 'active',
    foundAt: row.found_at ?? null,
    pausedAt: row.paused_at ?? null,
    settledAt: row.settled_at ?? null,
    settledAnswer: row.settled_answer ?? null,
    storyText: row.story_text ?? null,
    storyConsentAt: row.story_consent_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The customer's projects, oldest first (the order they were told). */
export const listMoveProjects = cache(async (customerId) => {
  try {
    const { rows } = await getPool().query(
      // created_at only: `id` does not exist before the multiple-projects migration.
      `SELECT * FROM customer_move_projects WHERE customer_id = $1 ORDER BY created_at`,
      [customerId],
    );
    return rows.map(fromRow);
  } catch (err) {
    if (err.code === MISSING_TABLE) return [];
    throw err;
  }
});

/** One of the customer's own projects, or null (someone else's id reads as missing). */
export async function getMoveProject(customerId, projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 0) return null;
  return (await listMoveProjects(customerId)).find((p) => p.id === id) || null;
}

// Column list shared by every write, in this order: $2.. of the values below.
const COLUMNS = [
  'reasons', 'reason_other', 'transaction_type', 'lease_term', 'household', 'bedrooms_min',
  'anchor_kind', 'anchor_commune', 'anchor_note', 'city', 'communes', 'priorities', 'budget_max', 'timeline',
  'current_home_type', 'current_commune', 'answered_steps', 'budget_min', 'title',
];
const ARRAY_COLUMNS = new Set(['reasons', 'communes', 'priorities', 'answered_steps']);

function projectValues(p, title) {
  return [
    p.reasons, p.reasonOther, p.transactionType, p.leaseTerm, p.household, p.bedroomsMin,
    p.anchorKind, p.anchorCommune, p.anchorNote, p.city, p.communes, p.priorities, p.budgetMax, p.timeline,
    p.currentHomeType, p.currentCommune, p.answeredSteps, p.budgetMin ?? null, title ?? null,
  ];
}

/** Columns and values without the ones a pre-migration table lacks. */
function writable({ withTitle, withBudgetMin }) {
  return COLUMNS.map((c, i) => ({ c, i })).filter(({ c }) => (c !== 'title' || withTitle) && (c !== 'budget_min' || withBudgetMin));
}

const cast = (c, n) => (ARRAY_COLUMNS.has(c) ? `$${n}::text[]` : `$${n}`);

/**
 * The one-row-per-customer upsert, used only before the multiple-projects
 * migration (the table's key is still customer_id then).
 */
async function legacyUpsert(customerId, project) {
  const values = projectValues(project, null);
  for (const withBudgetMin of [true, false]) {
    const cols = writable({ withTitle: false, withBudgetMin });
    const sql = `INSERT INTO customer_move_projects (customer_id, ${cols.map(({ c }) => c).join(', ')})
       VALUES ($1, ${cols.map(({ c }, k) => cast(c, k + 2)).join(', ')})
       ON CONFLICT (customer_id) DO UPDATE SET
       ${cols.map(({ c }) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()`;
    try {
      await getPool().query(sql, [customerId, ...cols.map(({ i }) => values[i])]);
      return { saved: true, id: LEGACY_PROJECT_ID };
    } catch (err) {
      if (err.code === MISSING_COLUMN && withBudgetMin) continue;
      if (err.code === MISSING_TABLE) return { saved: false, id: null };
      throw err;
    }
  }
  return { saved: false, id: null };
}

/**
 * A new project, refused past MAX_MOVE_PROJECTS by a COUNT guard in the same
 * INSERT (soft by design, like favourites and saved searches).
 * @returns {Promise<{saved: boolean, id: number|null, limit?: boolean}>}
 */
export async function createMoveProject(customerId, project, title = null) {
  const values = projectValues(project, title);
  const cols = writable({ withTitle: true, withBudgetMin: true });
  const n = cols.length + 2;
  try {
    const { rows } = await getPool().query(
      `INSERT INTO customer_move_projects (customer_id, ${cols.map(({ c }) => c).join(', ')})
       SELECT $1, ${cols.map(({ c }, k) => cast(c, k + 2)).join(', ')}
        WHERE (SELECT COUNT(*) FROM customer_move_projects WHERE customer_id = $1) < $${n}
       RETURNING id`,
      [customerId, ...cols.map(({ i }) => values[i]), MAX_MOVE_PROJECTS],
    );
    if (!rows.length) return { saved: false, id: null, limit: true };
    return { saved: true, id: Number(rows[0].id) };
  } catch (err) {
    if (err.code === MISSING_COLUMN) return legacyUpsert(customerId, project);
    if (err.code === MISSING_TABLE) {
      console.warn('[move-project] table missing, project not saved (run migrations/20261107_customer_move_projects.sql)');
      return { saved: false, id: null };
    }
    throw err;
  }
}

/**
 * Replaces every answer of one of the customer's projects (an answer the
 * customer cleared is cleared here too).
 * @returns {Promise<{saved: boolean, id: number|null}>}
 */
export async function updateMoveProject(customerId, projectId, project, title = null) {
  const id = Number(projectId);
  if (id === LEGACY_PROJECT_ID) return legacyUpsert(customerId, project);
  const values = projectValues(project, title);
  const cols = writable({ withTitle: true, withBudgetMin: true });
  try {
    const { rowCount } = await getPool().query(
      `UPDATE customer_move_projects
          SET ${cols.map(({ c }, k) => `${c} = ${cast(c, k + 3)}`).join(', ')}, updated_at = NOW()
        WHERE customer_id = $1 AND id = $2`,
      [customerId, id, ...cols.map(({ i }) => values[i])],
    );
    return rowCount ? { saved: true, id } : { saved: false, id: null };
  } catch (err) {
    if (err.code === MISSING_COLUMN) return legacyUpsert(customerId, project);
    if (err.code === MISSING_TABLE) return { saved: false, id: null };
    throw err;
  }
}

/** Deletes one of the customer's projects. Its alert stays (managed on the Alertes tab). */
export async function deleteMoveProject(customerId, projectId) {
  const id = Number(projectId);
  try {
    const sql = id === LEGACY_PROJECT_ID
      ? { text: 'DELETE FROM customer_move_projects WHERE customer_id = $1', values: [customerId] }
      : { text: 'DELETE FROM customer_move_projects WHERE customer_id = $1 AND id = $2', values: [customerId, id] };
    const { rowCount } = await getPool().query(sql.text, sql.values);
    return rowCount > 0;
  } catch (err) {
    if (err.code === MISSING_TABLE || err.code === MISSING_COLUMN) return false;
    throw err;
  }
}

/**
 * What the answers do on save: the project row (new, or `projectId`'s), plus
 * a saved search (the daily alerts and Accueil's "N nouveaux" run on it)
 * when the project names a transaction or a commune. The search label is
 * built like every other saved search's (lib/searchLabel.js), in the
 * customer's language.
 *
 * Never throws — a failure here must not cost the customer their account.
 * @returns {Promise<{saved: boolean, id: number|null, limit: boolean, alert: 'added'|'exists'|'limit'|null}>}
 */
export async function saveProjectAndAlert(customerId, project, t, { projectId = null, title = null } = {}) {
  let result = { saved: false, id: null, limit: false };
  try {
    result = { limit: false, ...(projectId == null
      ? await createMoveProject(customerId, project, title)
      : await updateMoveProject(customerId, projectId, project, title)) };
  } catch (err) {
    console.error(`[move-project] save failed for customer #${customerId}: ${err.message}`);
  }
  let alert = null;
  const query = result.saved ? moveSearchQuery(project) : null;
  if (query) {
    try {
      const label = buildSearchLabel(new URLSearchParams(query), t);
      alert = await addSavedSearch(customerId, { query, label });
    } catch (err) {
      console.error(`[move-project] saved search failed for customer #${customerId}: ${err.message}`);
    }
  }
  return { ...result, alert };
}

/**
 * The customer's own "C'est le bon !" / "Mettre en pause" / "Reprendre":
 * status plus the matching timestamp. Before the journey migration (42703)
 * nothing is written and `false` comes back, so the page can say so.
 */
export async function setMoveProjectStatus(customerId, projectId, status) {
  const id = Number(projectId);
  const stamp = { found: ', found_at = NOW(), paused_at = NULL', paused: ', paused_at = NOW()', active: ', paused_at = NULL, found_at = NULL' }[status];
  if (stamp === undefined) return false;
  try {
    const { rowCount } = await getPool().query(
      `UPDATE customer_move_projects SET status = $3${stamp}, updated_at = NOW()
        WHERE customer_id = $1 AND id = $2`,
      [customerId, id, status],
    );
    return rowCount > 0;
  } catch (err) {
    if (err.code === MISSING_COLUMN || err.code === MISSING_TABLE) return false;
    throw err;
  }
}

/** The "Bien installés ?" answer, the customer's story, and their consent (or not) to share it. */
export async function recordSettledCheckin(customerId, projectId, { answer, story, consent }) {
  try {
    const { rowCount } = await getPool().query(
      `UPDATE customer_move_projects
          SET settled_at = NOW(), settled_answer = $3, story_text = $4,
              story_consent_at = CASE WHEN $5::boolean AND $4::text IS NOT NULL THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE customer_id = $1 AND id = $2`,
      [customerId, Number(projectId), answer, story, Boolean(consent)],
    );
    return rowCount > 0;
  } catch (err) {
    if (err.code === MISSING_COLUMN || err.code === MISSING_TABLE) return false;
    throw err;
  }
}

/** Records the lead "Envoyer ma demande aux agences" created for one project. Never throws. */
export async function markMoveProjectSent(customerId, projectId, leadId) {
  const id = Number(projectId);
  try {
    if (id === LEGACY_PROJECT_ID) {
      await getPool().query(
        `UPDATE customer_move_projects SET last_lead_id = $2, last_lead_at = NOW() WHERE customer_id = $1`,
        [customerId, leadId],
      );
    } else {
      await getPool().query(
        `UPDATE customer_move_projects SET last_lead_id = $3, last_lead_at = NOW() WHERE customer_id = $1 AND id = $2`,
        [customerId, id, leadId],
      );
    }
  } catch (err) {
    console.warn(`[move-project] could not record lead #${leadId}: ${err.message}`);
  }
}
