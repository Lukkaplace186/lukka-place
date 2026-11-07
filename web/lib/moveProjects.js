import 'server-only';
import { cache } from 'react';
import { getPool } from './db';
import { addSavedSearch } from './customers';
import { buildSearchLabel } from './searchLabel';
import { moveSearchQuery } from './moveProjectRules';

/**
 * customer_move_projects (engine migrations/20261107_customer_move_projects.sql),
 * one row per customer. Rules and shapes: lib/moveProjectRules.js.
 *
 * Survives running before the migration: a missing table (42P01) reads as
 * "no project" and a write reports `saved: false` — signup itself never
 * fails because of it.
 */

const MISSING = new Set(['42P01', '42703']);

function fromRow(row) {
  if (!row) return null;
  return {
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
    budgetMax: row.budget_max,
    timeline: row.timeline,
    currentHomeType: row.current_home_type,
    currentCommune: row.current_commune,
    answeredSteps: row.answered_steps || [],
    lastLeadId: row.last_lead_id != null ? Number(row.last_lead_id) : null,
    lastLeadAt: row.last_lead_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const getMoveProject = cache(async (customerId) => {
  try {
    const { rows } = await getPool().query(`SELECT * FROM customer_move_projects WHERE customer_id = $1`, [customerId]);
    return fromRow(rows[0]);
  } catch (err) {
    if (MISSING.has(err.code)) return null;
    throw err;
  }
});

/**
 * Upserts the whole project (a re-run of the cards replaces every answer, so
 * an answer the customer cleared is cleared here too). `project` must come
 * from parseMoveProject.
 *
 * @returns {Promise<{saved: boolean}>}
 */
export async function saveMoveProject(customerId, project) {
  const p = project;
  try {
    await getPool().query(
      `INSERT INTO customer_move_projects (
         customer_id, reasons, reason_other, transaction_type, lease_term, household, bedrooms_min,
         anchor_kind, anchor_commune, anchor_note, city, communes, priorities, budget_max, timeline,
         current_home_type, current_commune, answered_steps)
       VALUES ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::text[], $14, $15, $16, $17, $18::text[])
       ON CONFLICT (customer_id) DO UPDATE SET
         reasons = EXCLUDED.reasons, reason_other = EXCLUDED.reason_other,
         transaction_type = EXCLUDED.transaction_type, lease_term = EXCLUDED.lease_term,
         household = EXCLUDED.household, bedrooms_min = EXCLUDED.bedrooms_min,
         anchor_kind = EXCLUDED.anchor_kind, anchor_commune = EXCLUDED.anchor_commune, anchor_note = EXCLUDED.anchor_note,
         city = EXCLUDED.city, communes = EXCLUDED.communes, priorities = EXCLUDED.priorities,
         budget_max = EXCLUDED.budget_max, timeline = EXCLUDED.timeline,
         current_home_type = EXCLUDED.current_home_type, current_commune = EXCLUDED.current_commune,
         answered_steps = EXCLUDED.answered_steps, updated_at = NOW()`,
      [
        customerId, p.reasons, p.reasonOther, p.transactionType, p.leaseTerm, p.household, p.bedroomsMin,
        p.anchorKind, p.anchorCommune, p.anchorNote, p.city, p.communes, p.priorities, p.budgetMax, p.timeline,
        p.currentHomeType, p.currentCommune, p.answeredSteps,
      ],
    );
    return { saved: true };
  } catch (err) {
    if (MISSING.has(err.code)) {
      console.warn('[move-project] table missing, project not saved (run migrations/20261107_customer_move_projects.sql)');
      return { saved: false };
    }
    throw err;
  }
}

/**
 * What the answers do on save: the project row, plus a saved search (the
 * daily alerts and Accueil's "N nouveaux" run on it) when the project names
 * a transaction or a commune. The search label is built like every other
 * saved search's (lib/searchLabel.js), in the customer's language.
 *
 * Never throws — a failure here must not cost the customer their account.
 * @returns {Promise<{saved: boolean, alert: 'added'|'exists'|'limit'|null}>}
 */
export async function saveProjectAndAlert(customerId, project, t) {
  let saved = false;
  let alert = null;
  try {
    ({ saved } = await saveMoveProject(customerId, project));
  } catch (err) {
    console.error(`[move-project] save failed for customer #${customerId}: ${err.message}`);
  }
  const query = moveSearchQuery(project);
  if (query) {
    try {
      const label = buildSearchLabel(new URLSearchParams(query), t);
      alert = await addSavedSearch(customerId, { query, label });
    } catch (err) {
      console.error(`[move-project] saved search failed for customer #${customerId}: ${err.message}`);
    }
  }
  return { saved, alert };
}

/** Records the lead "Envoyer ma demande aux agences" created. Never throws. */
export async function markMoveProjectSent(customerId, leadId) {
  try {
    await getPool().query(
      `UPDATE customer_move_projects SET last_lead_id = $2, last_lead_at = NOW() WHERE customer_id = $1`,
      [customerId, leadId],
    );
  } catch (err) {
    console.warn(`[move-project] could not record lead #${leadId}: ${err.message}`);
  }
}
