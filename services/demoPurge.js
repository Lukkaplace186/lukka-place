/**
 * "Réinitialiser" / "Supprimer" a demo pair (web /admin/demo): the engine half,
 * which removes what the pair left in SQLite — its leads, visits, matches,
 * proposals, conversations and WhatsApp history. Web removes the Postgres half.
 *
 * Only demo identifiers are ever accepted: every phone must be a reserved demo
 * number (services/demoAccounts.js), and every agent id must belong to an
 * `agents` row whose phone is one. A real customer's lead is never deleted,
 * even if it was (wrongly) assigned to a demo agent: leads go only by the
 * demo phones.
 *
 * Tables are found by their columns rather than listed by hand, so a table
 * added later that keys on wa_id / lead_id / viewing_request_id / agent_id is
 * cleaned without anyone remembering to add it here. Rows that point at a
 * doomed row through a declared foreign key go with it (SQLite enforces them
 * here), found from PRAGMA foreign_key_list until nothing new turns up.
 */

const db = require('./db');
const demoAccounts = require('./demoAccounts');

const PHONE_COLUMNS = ['wa_id', 'agent_phone', 'lead_wa_id', 'customer_wa_id'];
const MAX_ROUNDS = 10;

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

/** Agent ids that really are demo agents (Postgres), or an error. */
async function confirmDemoAgentIds(agentIds) {
  const ids = [...new Set((agentIds || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!ids.length) return [];
  // eslint-disable-next-line global-require
  const postgres = require('./postgres');
  if (!postgres.isConfigured()) throw new Error('Postgres is not configured');
  const { rows } = await postgres.getPool().query(
    `SELECT id FROM agents WHERE id = ANY($1::bigint[]) AND COALESCE(phone, '') LIKE '${demoAccounts.DEMO_PHONE_PREFIX}%'`,
    [ids],
  );
  const confirmed = rows.map((r) => Number(r.id));
  const refused = ids.filter((id) => !confirmed.includes(id));
  if (refused.length) throw new Error(`not demo agents: ${refused.join(', ')}`);
  return confirmed;
}

/** The rows a demo pair owns directly, as {table: SQL condition + params}. */
function seedConditions(sqlite, tables, { digits, agents, leadIds, viewingIds }) {
  const seeds = {};
  for (const table of tables) {
    const cols = new Set(sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name));
    const where = [];
    const params = [];
    if (table === 'leads') {
      if (leadIds.length) { where.push(`id IN (${placeholders(leadIds)})`); params.push(...leadIds); }
    } else if (table === 'viewing_requests') {
      if (viewingIds.length) { where.push(`id IN (${placeholders(viewingIds)})`); params.push(...viewingIds); }
    } else {
      for (const col of PHONE_COLUMNS) {
        if (cols.has(col)) { where.push(`"${col}" IN (${placeholders(digits)})`); params.push(...digits); }
      }
      if (cols.has('lead_id') && leadIds.length) { where.push(`lead_id IN (${placeholders(leadIds)})`); params.push(...leadIds); }
      if (cols.has('viewing_request_id') && viewingIds.length) {
        where.push(`viewing_request_id IN (${placeholders(viewingIds)})`); params.push(...viewingIds);
      }
      if (cols.has('agent_id') && agents.length) { where.push(`agent_id IN (${placeholders(agents)})`); params.push(...agents); }
    }
    if (where.length) seeds[table] = { sql: where.join(' OR '), params };
  }
  return seeds;
}

/**
 * @param {{phones: string[], agentIds?: number[], dryRun?: boolean}} input
 * @returns {Promise<{deleted: Object<string, number>, leads: number, viewings: number}>}
 */
async function purgeDemoEngineData({ phones = [], agentIds = [], dryRun = false } = {}) {
  const digits = [...new Set((phones || []).map((p) => String(p || '').replace(/\D/g, '')))].filter(Boolean);
  if (!digits.length) throw new Error('phones are required');
  const notDemo = digits.filter((p) => !demoAccounts.isDemoPhone(p));
  if (notDemo.length) throw new Error(`not demo numbers: ${notDemo.join(', ')}`);
  const agents = await confirmDemoAgentIds(agentIds);

  const sqlite = db.db;
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);

  const leadIds = tables.includes('leads')
    ? sqlite.prepare(`SELECT id FROM leads WHERE wa_id IN (${placeholders(digits)})`).all(...digits).map((r) => r.id)
    : [];
  const viewingIds = tables.includes('viewing_requests') && leadIds.length
    ? sqlite.prepare(`SELECT id FROM viewing_requests WHERE lead_id IN (${placeholders(leadIds)})`).all(...leadIds).map((r) => r.id)
    : [];

  // The doomed rowids per table: the seeds, then whatever references them.
  const doomed = new Map();
  const add = (table, rowids) => {
    if (!doomed.has(table)) doomed.set(table, new Set());
    const set = doomed.get(table);
    let grew = false;
    for (const id of rowids) if (!set.has(id)) { set.add(id); grew = true; }
    return grew;
  };
  const seeds = seedConditions(sqlite, tables, { digits, agents, leadIds, viewingIds });
  for (const [table, { sql, params }] of Object.entries(seeds)) {
    add(table, sqlite.prepare(`SELECT rowid AS r FROM "${table}" WHERE ${sql}`).all(...params).map((x) => x.r));
  }
  const foreignKeys = tables.flatMap((child) => sqlite.prepare(`PRAGMA foreign_key_list("${child}")`).all()
    .filter((fk) => tables.includes(fk.table))
    .map((fk) => ({ child, from: fk.from, parent: fk.table, to: fk.to || 'rowid' })));
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let grew = false;
    for (const fk of foreignKeys) {
      const parentRows = [...(doomed.get(fk.parent) || [])];
      if (!parentRows.length) continue;
      const keys = sqlite
        .prepare(`SELECT "${fk.to}" AS k FROM "${fk.parent}" WHERE rowid IN (${placeholders(parentRows)})`)
        .all(...parentRows)
        .map((x) => x.k)
        .filter((k) => k != null);
      if (!keys.length) continue;
      const children = sqlite
        .prepare(`SELECT rowid AS r FROM "${fk.child}" WHERE "${fk.from}" IN (${placeholders(keys)})`)
        .all(...keys)
        .map((x) => x.r);
      if (add(fk.child, children)) grew = true;
    }
    if (!grew) break;
  }

  const deleted = {};
  for (const [table, set] of doomed) if (set.size) deleted[table] = set.size;
  if (!dryRun) {
    sqlite.transaction(() => {
      // Every referencing row is in the doomed set too, so deferring the
      // checks to the commit only spares us ordering the deletes.
      sqlite.pragma('defer_foreign_keys = ON');
      for (const [table, set] of doomed) {
        const ids = [...set];
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          sqlite.prepare(`DELETE FROM "${table}" WHERE rowid IN (${placeholders(chunk)})`).run(...chunk);
        }
      }
    })();
  }
  console.log(
    `[demo] ${dryRun ? 'would purge' : 'purged'} ${digits.join(', ')} (agents ${agents.join(', ') || 'none'}): ${JSON.stringify(deleted)}`,
  );
  return { deleted, leads: leadIds.length, viewings: viewingIds.length };
}

module.exports = { purgeDemoEngineData };
