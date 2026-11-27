import 'server-only';
import { getPool } from './db';

/**
 * The smallest budget an agency takes (2026-11-25; engine
 * services/agentMinBudget.js, docs/claude/leads-and-enquiries.md "Agency
 * minimum budget"). The engine's matching skips an agency when a request's
 * budget ceiling is under its minimum. Edited here from the admin agent page
 * and the agent's Réglages; an agency can also type it in reply to an alert.
 *
 * NULL = takes every budget. Before migrations/20261125_agent_min_budget.sql
 * runs, the read returns `available: false` and the write refuses quietly.
 */

const EMPTY = { rental: null, sale: null, updatedAt: null, source: null, available: false };

function positive(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getAgentMinBudget(agentId) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isInteger(id)) return EMPTY;
  try {
    const { rows } = await getPool().query(
      `SELECT min_rental_budget, min_sale_budget, min_budget_updated_at, min_budget_source
         FROM agents WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return EMPTY;
    return {
      rental: positive(row.min_rental_budget),
      sale: positive(row.min_sale_budget),
      updatedAt: row.min_budget_updated_at || null,
      source: row.min_budget_source || null,
      available: true,
    };
  } catch (err) {
    if (err.code !== '42703') console.error(`[agentMinBudget] read #${id} failed: ${err.message}`);
    return EMPTY;
  }
}

/**
 * A form value as a minimum: '' → null (no minimum), "1 500" / "1500 $" →
 * 1500, anything else (or out of range) → undefined (refused).
 */
export function parseMinBudgetInput(value, { max = 50000000 } = {}) {
  const raw = String(value ?? '').replace(/[\s  $]/g, '').replace(/usd$/i, '');
  if (raw === '') return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return undefined;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > max) return undefined;
  return n;
}

/**
 * Save both minimums. Only the ones passed (not undefined) are written.
 * @returns {Promise<boolean>} true when written; false before the migration
 */
export async function setAgentMinBudget(agentId, { rental, sale, source }) {
  if (!['admin', 'agent'].includes(source)) throw new Error(`unknown source '${source}'`);
  const sets = [];
  const values = [Number.parseInt(agentId, 10)];
  if (rental !== undefined) {
    values.push(rental);
    sets.push(`min_rental_budget = $${values.length}`);
  }
  if (sale !== undefined) {
    values.push(sale);
    sets.push(`min_sale_budget = $${values.length}`);
  }
  if (!sets.length) return false;
  values.push(source);
  try {
    const { rowCount } = await getPool().query(
      `UPDATE agents SET ${sets.join(', ')}, min_budget_updated_at = NOW(), min_budget_source = $${values.length}
        WHERE id = $1 AND deleted_at IS NULL`,
      values,
    );
    return rowCount > 0;
  } catch (err) {
    if (err.code === '42703') return false;
    throw err;
  }
}
