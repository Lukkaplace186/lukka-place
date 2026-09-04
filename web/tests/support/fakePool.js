/**
 * Drop-in replacement for lib/db.js in the unit tier (see hooks.mjs). Not a
 * database emulator — it records the SQL it is handed and replays rows the
 * test queued. That buys the assertion class that actually matters here:
 * **SQL text invariants**.
 *
 * The most important one: every exported read in lib/listings.js must emit
 * `p.status = 1 AND p.approve_status = 1`. There is no Row Level Security on
 * `properties` (see web/CLAUDE.md), so that query-time filter is the only
 * thing keeping unapproved listings private. A row-comparison test against
 * real data would pass just as happily with the filter deleted, as long as
 * the fixture happened to contain no pending rows. Asserting on the SQL
 * itself cannot be fooled that way.
 */

/** Every query this pool has seen, in order: `{ text, values }`. */
export const calls = [];

/** FIFO of result sets to hand back, queued by the test via `enqueue()`. */
const queued = [];

/** Queue one result set for the next query. Rows default to `[]` when empty. */
export function enqueue(rows) {
  queued.push(Array.isArray(rows) ? rows : []);
}

/** Forget all recorded calls and queued rows — call in a `beforeEach`. */
export function reset() {
  calls.length = 0;
  queued.length = 0;
}

/** The single most recent query, or undefined. */
export function lastCall() {
  return calls[calls.length - 1];
}

/** Collapse whitespace so assertions can match SQL without minding formatting. */
export function normalizeSql(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * When nothing is queued, answer by query *shape* rather than always `[]`.
 *
 * getListings runs a widening ladder (relaxed-commune, then wider radius
 * tiers), so the exact number and order of COUNT vs data queries depends on
 * the filters under test. Making a test enumerate that order exactly is
 * brittle for no benefit — and getting it wrong crashes inside the module
 * (`countRows[0].total` on an empty array), which reads as a product bug
 * when it is really a fixture bug.
 *
 * A COUNT query therefore defaults to a real zero row, and everything else
 * to no rows. A test that cares about a specific count still enqueues one
 * explicitly and that always wins.
 */
function defaultRowsFor(sql) {
  const upper = sql.toUpperCase();
  const isCount = upper.includes('COUNT(*) AS TOTAL') || upper.includes('COUNT(*) AS N');
  return isCount ? [{ total: '0', n: '0' }] : [];
}

async function query(text, values) {
  const sql = normalizeSql(text);
  calls.push({ text, values, sql });
  const rows = queued.length ? queued.shift() : defaultRowsFor(sql);
  return { rows, rowCount: rows.length };
}

const pool = {
  query,
  async connect() {
    return { query, release() {} };
  },
  async end() {},
};

/** Mirrors lib/db.js's own export shape — the module under test can't tell. */
export function getPool() {
  return pool;
}

const dbModule = { getPool };
export default dbModule;
