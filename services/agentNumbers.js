/**
 * Extra WhatsApp numbers an agent sends listings from
 * (migrations/20261103_agent_whatsapp_numbers.sql has the why).
 *
 * Two halves:
 *
 *  - The MATCH. identifySender, resolveAgentId and the WhatsApp quota all
 *    asked "whose number is this?" against agents.phone alone. They now ask
 *    it through `numberMatchSql`, which also accepts a number the team linked
 *    to the agent. The agent's own phone wins when both match
 *    (`ownNumberFirstSql`), and every other gate — phone_verified_at,
 *    deleted_at — still applies to the AGENT, unchanged.
 *
 *  - The ADMIN side (add / remove / list), behind requireApiKey and called
 *    only from the console, like services/adminAgentAccounts.js. Adding a
 *    number skips proof of ownership on purpose: the team vouches for it.
 *    It claims the listings already filed under that number.
 *
 * The table may not exist yet (engine deployed before the migration):
 * `extraNumbersAvailable` asks to_regclass and every caller then runs the old
 * phone-only SQL, so nothing 42P01s — not even inside the sync transaction,
 * where a failed statement would abort the whole publish.
 */

'use strict';

const TABLE = 'agent_whatsapp_numbers';
/** How long a "table not there yet" answer is trusted before asking again. */
const RECHECK_MS = 60 * 1000;

let available = false;
let checkedAt = 0;

/**
 * Does the table exist? A yes is kept for the life of the process (the
 * migration is never undone); a no is re-asked after a minute. Never throws.
 *
 * @param {{query: Function}} queryable a pg Pool or a client mid-transaction
 */
async function extraNumbersAvailable(queryable) {
  if (available) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return false;
  checkedAt = Date.now();
  try {
    const { rows } = await queryable.query(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS available`);
    available = rows?.[0]?.available === true;
  } catch {
    available = false;
  }
  return available;
}

/** Tests only: forget what was learnt about the table. */
function resetAvailability(value = false) {
  available = value;
  checkedAt = value ? Date.now() : 0;
}

/**
 * "This agents row answers to number $param." `alias` is '' or 'a.'.
 * Without the table it is exactly the old phone-only condition.
 */
function numberMatchSql(alias, param, withExtra) {
  const own = `regexp_replace(${alias}phone, '\\D', '', 'g') = ${param}`;
  if (!withExtra) return own;
  return `(${own} OR ${alias}id IN (SELECT w.agent_id FROM ${TABLE} w WHERE w.phone = ${param}))`;
}

/** ORDER BY prefix: the account whose own phone it is beats one it is linked to. */
function ownNumberFirstSql(alias, param, withExtra) {
  return withExtra ? `(regexp_replace(${alias}phone, '\\D', '', 'g') = ${param}) DESC, ` : '';
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

function adminAccounts() {
  return require('./adminAgentAccounts');
}

/**
 * Link a number to an agent. Refused: not 7–15 digits, one of our own
 * numbers, any LIVE agent's own phone (that account already answers to it —
 * a soft-deleted one does not), or a number already linked to anyone.
 *
 * @returns {Promise<{agentId: number, phone: string, claimed: object}>}
 */
async function addAgentNumber(agentId, phone, { addedBy = null } = {}) {
  const { checkPhone, claimListingsForNumber, AdminAgentError } = adminAccounts();
  const postgres = require('./postgres');
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) throw new AdminAgentError('not-found', 'agent id is required');
  const digits = checkPhone(phone);
  if (!postgres.isConfigured()) throw new AdminAgentError('postgres-unavailable', 'Postgres is not configured');

  const client = await postgres.getPool().connect();
  try {
    if (!(await extraNumbersAvailable(client))) {
      throw new AdminAgentError('numbers-unavailable', `${TABLE} does not exist yet — run the migration`);
    }
    await client.query('BEGIN');
    // Same per-number lock admin-create takes: agents.phone has no unique
    // constraint, so two simultaneous claims of one number must queue.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent-phone:${digits}`]);

    const { rows: agents } = await client.query(
      'SELECT id, regexp_replace(phone, \'\\D\', \'\', \'g\') AS digits, deleted_at FROM agents WHERE id = $1',
      [id],
    );
    const agent = agents[0];
    if (!agent || agent.deleted_at) throw new AdminAgentError('not-found', `no live agent #${id}`);
    if (agent.digits === digits) throw new AdminAgentError('phone-own', `${digits} is already agent #${id}'s own number`);

    const { rows: owners } = await client.query(
      `SELECT id FROM agents
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [digits],
    );
    if (owners.length) {
      throw new AdminAgentError('phone-taken', `${digits} belongs to agent #${owners[0].id}`, { agentId: Number(owners[0].id) });
    }

    const { rows: linked } = await client.query(`SELECT agent_id FROM ${TABLE} WHERE phone = $1`, [digits]);
    if (linked.length) {
      throw new AdminAgentError('phone-linked', `${digits} is already linked to agent #${linked[0].agent_id}`, {
        agentId: Number(linked[0].agent_id),
      });
    }

    await client.query(`INSERT INTO ${TABLE} (agent_id, phone, added_by) VALUES ($1, $2, $3)`, [
      id, digits, addedBy ? String(addedBy).slice(0, 160) : null,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const claimed = await claimListingsForNumber(digits, id);
  console.log(`[agent-numbers] linked ${digits} to agent #${id}; claimed ${claimed.linkedIds.length} listing(s)`);
  return { agentId: id, phone: digits, claimed };
}

/**
 * Unlink a number. Listings already attributed stay where they are: an
 * attribution is never moved by a later change of mind (linkListingsToAgent
 * only ever fills a NULL, and nothing here clears one).
 *
 * @returns {Promise<{agentId: number, phone: string, removed: boolean}>}
 */
async function removeAgentNumber(agentId, phone) {
  const { AdminAgentError } = adminAccounts();
  const postgres = require('./postgres');
  const id = Number.parseInt(agentId, 10);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!Number.isFinite(id) || !digits) throw new AdminAgentError('not-found', 'agent id and phone are required');
  if (!postgres.isConfigured()) throw new AdminAgentError('postgres-unavailable', 'Postgres is not configured');
  const pool = postgres.getPool();
  if (!(await extraNumbersAvailable(pool))) return { agentId: id, phone: digits, removed: false };
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE agent_id = $1 AND phone = $2`, [id, digits]);
  if (rowCount) console.log(`[agent-numbers] unlinked ${digits} from agent #${id}`);
  return { agentId: id, phone: digits, removed: rowCount > 0 };
}

/**
 * The agent's linked numbers, oldest first. `available: false` before the
 * migration, so the console can say so rather than show an empty list.
 *
 * @returns {Promise<{available: boolean, numbers: {phone: string, addedBy: string|null, createdAt: string}[]}>}
 */
async function listAgentNumbers(agentId) {
  const postgres = require('./postgres');
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id) || !postgres.isConfigured()) return { available: false, numbers: [] };
  const pool = postgres.getPool();
  if (!(await extraNumbersAvailable(pool))) return { available: false, numbers: [] };
  const { rows } = await pool.query(
    `SELECT phone, added_by, created_at FROM ${TABLE} WHERE agent_id = $1 ORDER BY created_at, id`,
    [id],
  );
  return {
    available: true,
    numbers: rows.map((r) => ({
      phone: r.phone,
      addedBy: r.added_by || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    })),
  };
}

module.exports = {
  extraNumbersAvailable,
  resetAvailability,
  numberMatchSql,
  ownNumberFirstSql,
  addAgentNumber,
  removeAgentNumber,
  listAgentNumbers,
  TABLE,
};
