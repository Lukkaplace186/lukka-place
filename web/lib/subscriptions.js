import 'server-only';
import { getPool } from './db';

/**
 * Real memberships/packages data (7 real membership rows, 9 real packages —
 * confirmed directly, not seed data). One real membership row's vendor_id
 * doesn't resolve to a current vendors row (no FK enforces this at the DB
 * level) — LEFT JOIN so that row still shows up with '—' instead of being
 * silently dropped.
 *
 * Each row here IS a payment record, not just a subscription state — this
 * table already accumulates one row per assignment/renewal (see
 * assignPackageToAgent below), so the admin "payment history" view is just
 * this same list, ordered by when it happened. `payment_method`/
 * `transaction_id`/`receipt` are real columns that sat unused before this —
 * see web/CLAUDE.md's no-fabricated-data rule for why "manual ledger" means
 * surfacing what's actually stored, not inventing a separate table.
 */
export async function getMemberships() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT mem.id, mem.status, mem.is_trial, mem.price, mem.currency, mem.currency_symbol,
            mem.payment_method, mem.transaction_id, mem.start_date, mem.expire_date, mem.created_at,
            pkg.id AS package_id, pkg.title AS package_title,
            v.id AS vendor_id, v.username AS vendor_username
     FROM memberships mem
     LEFT JOIN packages pkg ON pkg.id = mem.package_id
     LEFT JOIN vendors v ON v.id = mem.vendor_id
     ORDER BY mem.created_at DESC`,
  );
  return rows;
}

export const PACKAGE_TERMS = ['monthly', 'yearly', 'lifetime'];

/** @returns {Promise<Array<{id, title, price, term, number_of_property, is_trial, trial_days, status}>>} */
export async function getPackages() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, title, price, term, number_of_property, is_trial, trial_days, status
     FROM packages
     ORDER BY status DESC, price ASC`,
  );
  return rows;
}

function assertValidTerm(term) {
  if (!PACKAGE_TERMS.includes(term)) {
    throw new Error(`term must be one of: ${PACKAGE_TERMS.join(', ')}`);
  }
}

/**
 * `packages.id`/`memberships.id` have no DB-side default (this legacy
 * Laravel/Zipprr schema assigns ids app-side, same as `vendors.id` and
 * `agents.id` elsewhere in this codebase) — computed against the same
 * client a caller is already inside a transaction on, where one is passed.
 */
async function nextId(client, table) {
  const { rows } = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${table}`);
  return rows[0].id;
}

/**
 * @param {{title: string, price: number, term: string, numberOfProperty: number|null, isTrial: boolean, trialDays: number}} input
 * @returns {Promise<number>} the new package id
 */
export async function createPackage({ title, price, term, numberOfProperty, isTrial, trialDays }) {
  assertValidTerm(term);
  const pool = getPool();
  const id = await nextId(pool, 'packages');
  await pool.query(
    `INSERT INTO packages (id, title, price, term, number_of_property, is_trial, trial_days, status, is_featured, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, NOW(), NOW())`,
    [id, title, price, term, numberOfProperty, isTrial ? 1 : 0, trialDays || 0],
  );
  return id;
}

export async function updatePackage(id, { title, price, term, numberOfProperty, isTrial, trialDays, status }) {
  assertValidTerm(term);
  const pool = getPool();
  await pool.query(
    `UPDATE packages
     SET title = $1, price = $2, term = $3, number_of_property = $4, is_trial = $5, trial_days = $6, status = $7, updated_at = NOW()
     WHERE id = $8`,
    [title, price, term, numberOfProperty, isTrial ? 1 : 0, trialDays || 0, status, id],
  );
}

/** monthly -> +1 month, yearly -> +1 year, lifetime -> the '9999' sentinel this schema already uses elsewhere (see web/app/admin/subscriptions/page.js's own formatDate). A real trial overrides the term entirely with a short, real expiry. */
function computeExpireDate(term, { isTrial, trialDays }) {
  if (isTrial && trialDays > 0) {
    return new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
  }
  if (term === 'lifetime') return new Date('9999-12-30T00:00:00Z');
  const date = new Date();
  if (term === 'yearly') date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  return date;
}

/**
 * Assigns a real package to a real agent, recording it as a new
 * `memberships` row (this schema's real payment ledger — see getMemberships'
 * doc comment). An agent with no `vendor_id` yet gets a real vendor row
 * created for them first (memberships key off vendor_id, not agent_id
 * directly) — mirrors the same ad-hoc creation this app already does
 * elsewhere when an agent's agency doesn't exist yet.
 *
 * @param {Object} input
 * @param {number} input.agentId
 * @param {number} input.packageId
 * @param {boolean} [input.isTrial]
 * @param {number|null} [input.price] Manual ledger entry — what was actually paid/agreed, independent of the package's own list price.
 * @param {string|null} [input.currency]
 * @param {string|null} [input.currencySymbol]
 * @param {string|null} [input.paymentMethod]
 * @param {string|null} [input.transactionId]
 * @param {string|null} [input.receipt]
 * @returns {Promise<{membershipId: number, vendorId: number}>}
 */
export async function assignPackageToAgent({
  agentId, packageId, isTrial = false, price = null, currency = null, currencySymbol = null,
  paymentMethod = null, transactionId = null, receipt = null,
}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: agentRows } = await client.query(
      'SELECT id, vendor_id, username FROM agents WHERE id = $1',
      [agentId],
    );
    if (!agentRows.length) throw new Error(`No agent #${agentId}`);
    let vendorId = agentRows[0].vendor_id;

    if (!vendorId) {
      vendorId = await nextId(client, 'vendors');
      await client.query(
        `INSERT INTO vendors (id, username, status, created_at, updated_at) VALUES ($1, $2, 1, NOW(), NOW())`,
        [vendorId, agentRows[0].username],
      );
      await client.query('UPDATE agents SET vendor_id = $1, updated_at = NOW() WHERE id = $2', [vendorId, agentId]);
    }

    const { rows: packageRows } = await client.query(
      'SELECT id, term, trial_days FROM packages WHERE id = $1',
      [packageId],
    );
    if (!packageRows.length) throw new Error(`No package #${packageId}`);
    const { term, trial_days: packageTrialDays } = packageRows[0];

    const expireDate = computeExpireDate(term, { isTrial, trialDays: packageTrialDays || 0 });
    const membershipId = await nextId(client, 'memberships');

    await client.query(
      `INSERT INTO memberships
         (id, package_id, vendor_id, status, is_trial, trial_days, price, currency, currency_symbol,
          payment_method, transaction_id, receipt, start_date, expire_date, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12, NOW(), NOW())`,
      [
        membershipId, packageId, vendorId, isTrial ? 1 : 0, isTrial ? (packageTrialDays || 0) : 0,
        price, currency, currencySymbol, paymentMethod, transactionId, receipt, expireDate,
      ],
    );

    await client.query('COMMIT');
    return { membershipId, vendorId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getFeaturedPricings() {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, price, number_of_days FROM featured_pricings WHERE status = 1 ORDER BY number_of_days',
  );
  return rows;
}

/** Which real properties.id values currently have an active featured_properties row. */
export async function getFeaturedPropertyIds() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT property_id FROM featured_properties WHERE status = 1 AND end_date > NOW()`,
  );
  return new Set(rows.map((r) => Number(r.property_id)));
}
