import 'server-only';
import { cache } from 'react';
import { randomBytes } from 'node:crypto';
import { getPool } from './db';
import { demoPhonesFor, isDemoPhone } from './demoPhone';
import { hashPassword as hashCustomerPassword } from './customerAuth';
import { deleteAgentAccount, LISTING_CHILD_TABLES } from './adminAgentDeletion';
import { purgeDemoEngineData } from './adminApi';
import { getCurrentCustomerId } from './customers';
import { getCurrentAgentId } from './agentSession';

/**
 * Demo accounts (2026-11-14, owner request) — the web half.
 *
 * A pair is one demo customer and one demo agent, made from /admin/demo, that
 * the team signs into to use the product exactly as a customer or an agent
 * would. They are real `customers` / `agents` rows, so every page, action and
 * engine flow runs unchanged; what keeps them sealed:
 *
 *   - Reserved numbers 2430000 1NNNN / 2NNNN (lib/demoPhone.js). The engine
 *     never sends anything to them (it records it, and copies it to
 *     `deliver_to_phone` when set), and nothing reaches a real number while a
 *     demo session is the one acting (engine services/demoAccounts.js).
 *   - The demo customer's requests go to the paired demo agent only, never a
 *     listing's agent, a wave of agencies or the desk; a demo agent is never
 *     matched to a real customer.
 *   - A demo agent's listing can never be approved: the Postgres trigger
 *     `properties_demo_guard` holds it pending whoever approves it.
 *   - The demo agent is `is_test`, so market, investor and founder figures
 *     already leave it out; its page views count as staff.
 *   - "Réinitialiser" deletes everything both accounts made (engine SQLite and
 *     Postgres) and recreates them, same numbers; "Supprimer" deletes.
 *
 * Every read checks the table exists first: before
 * migrations/20261114_demo_accounts.sql nothing here throws, there are simply
 * no demo accounts.
 */

export const DEMO_LABEL_MAX = 80;

let tableKnown = null;
let tableCheckedAt = 0;

export async function demoTableReady(pool = getPool()) {
  if (tableKnown === true) return true;
  if (tableKnown === false && Date.now() - tableCheckedAt < 60 * 1000) return false;
  const { rows } = await pool.query("SELECT to_regclass('public.demo_accounts') IS NOT NULL AS ok");
  tableKnown = Boolean(rows[0]?.ok);
  tableCheckedAt = Date.now();
  return tableKnown;
}

const PAIR_FIELDS = `d.id, d.label, d.agent_id, d.customer_id, d.agent_phone, d.customer_phone,
  d.deliver_to_phone, d.created_by, d.created_at, d.reset_at`;

function shape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    label: row.label,
    agentId: row.agent_id == null ? null : Number(row.agent_id),
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    agentPhone: row.agent_phone,
    customerPhone: row.customer_phone,
    deliverTo: row.deliver_to_phone || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    resetAt: row.reset_at || null,
    agentName: row.agent_name ?? null,
    customerName: row.customer_name ?? null,
    listings: row.listings == null ? null : Number(row.listings),
    favorites: row.favorites == null ? null : Number(row.favorites),
  };
}

export async function listDemoAccounts() {
  const pool = getPool();
  if (!(await demoTableReady(pool))) return { ready: false, rows: [] };
  const { rows } = await pool.query(
    `SELECT ${PAIR_FIELDS},
            COALESCE(NULLIF(TRIM(a.agency_name), ''), NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '')) AS agent_name,
            c.full_name AS customer_name,
            (SELECT count(*) FROM properties p WHERE p.agent_id = d.agent_id)::int AS listings,
            (SELECT count(*) FROM customer_favorites f WHERE f.customer_id = d.customer_id)::int AS favorites
       FROM demo_accounts d
       LEFT JOIN agents a ON a.id = d.agent_id
       LEFT JOIN LATERAL (
         SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id
         ORDER BY (language_id = 20) DESC, language_id LIMIT 1
       ) ai ON true
       LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.deleted_at IS NULL
      ORDER BY d.id DESC`,
  );
  return { ready: true, rows: rows.map(shape) };
}

export async function getDemoAccount(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const pool = getPool();
  if (!(await demoTableReady(pool))) return null;
  const { rows } = await pool.query(`SELECT ${PAIR_FIELDS} FROM demo_accounts d WHERE d.id = $1 AND d.deleted_at IS NULL`, [n]);
  return shape(rows[0]);
}

/** The live pair this customer id belongs to, or null. Never throws. */
export async function getDemoPairForCustomer(customerId) {
  const n = Number(customerId);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  try {
    const pool = getPool();
    if (!(await demoTableReady(pool))) return null;
    const { rows } = await pool.query(
      `SELECT ${PAIR_FIELDS} FROM demo_accounts d WHERE d.customer_id = $1 AND d.deleted_at IS NULL LIMIT 1`,
      [n],
    );
    return shape(rows[0]);
  } catch (err) {
    console.error(`[demo] pair lookup for customer #${n}: ${err.message}`);
    return null;
  }
}

/** The live pair this agent id belongs to, or null. Never throws. */
export async function getDemoPairForAgent(agentId) {
  const n = Number(agentId);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  try {
    const pool = getPool();
    if (!(await demoTableReady(pool))) return null;
    const { rows } = await pool.query(
      `SELECT ${PAIR_FIELDS} FROM demo_accounts d WHERE d.agent_id = $1 AND d.deleted_at IS NULL LIMIT 1`,
      [n],
    );
    return shape(rows[0]);
  } catch (err) {
    console.error(`[demo] pair lookup for agent #${n}: ${err.message}`);
    return null;
  }
}

/** The pair of the signed-in customer, when that customer is a demo one. */
export const currentDemoCustomerPair = cache(async () => {
  let customerId = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    return null;
  }
  return customerId ? getDemoPairForCustomer(customerId) : null;
});

/** The pair of the signed-in agent, when that agent is a demo one. */
export const currentDemoAgentPair = cache(async () => {
  let agentId = null;
  try {
    agentId = await getCurrentAgentId();
  } catch {
    return null;
  }
  return agentId ? getDemoPairForAgent(agentId) : null;
});

/**
 * The number a public form should use: the demo customer's own when the
 * signed-in customer is a demo one (whatever was typed), else `phone` as is.
 * The engine routes a demo number to the paired demo agent.
 */
export async function demoCustomerPhoneOr(phone) {
  const pair = await currentDemoCustomerPair();
  return pair ? pair.customerPhone : phone;
}

/** A customer id that belongs to a demo pair? (refuses phone change, deletion) */
export async function isDemoCustomer(customerId) {
  return Boolean(await getDemoPairForCustomer(customerId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function parseDemoForm(formData, { normalizePhone } = {}) {
  const label = String(formData.get('label') || '').trim().replace(/\s+/g, ' ').slice(0, DEMO_LABEL_MAX);
  if (!label) return { ok: false, errorKey: 'admin.demo.errorLabel' };
  const agentName = String(formData.get('agent_name') || '').trim().slice(0, 80) || 'Agent démo';
  const agencyName = String(formData.get('agency_name') || '').trim().slice(0, 160) || `Agence démo — ${label}`;
  const customerName = String(formData.get('customer_name') || '').trim().slice(0, 120) || 'Client démo';
  const rawPhone = String(formData.get('deliver_to') || '').trim();
  let deliverTo = null;
  if (rawPhone) {
    deliverTo = normalizePhone
      ? normalizePhone(rawPhone, String(formData.get('deliver_toCountry') || ''))
      : rawPhone.replace(/\D/g, '');
    if (!deliverTo || !/^\d{7,15}$/.test(deliverTo) || isDemoPhone(deliverTo)) {
      return { ok: false, errorKey: 'admin.demo.errorPhone' };
    }
  }
  return { ok: true, values: { label, agentName, agencyName, customerName, deliverTo } };
}

async function insertAccounts(client, { agentPhone, customerPhone, agentName, agencyName, customerName }) {
  const [first, ...rest] = agentName.split(' ');
  const { rows: agentRows } = await client.query(
    `INSERT INTO agents
       (username, phone, status, agency_name, phone_verified_at, onboarding_source, is_test, created_at, updated_at)
     VALUES ($1, $2, 1, $3, NOW(), 'demo', true, NOW(), NOW())
     RETURNING id`,
    [agentName, agentPhone, agencyName],
  );
  const agentId = Number(agentRows[0].id);
  await client.query(
    `INSERT INTO agent_infos (agent_id, language_id, first_name, last_name, created_at, updated_at)
     VALUES ($1, 20, $2, $3, NOW(), NOW())`,
    [agentId, first || agentName, rest.join(' ') || null],
  );
  // Nobody signs in with a password: the console opens the account. The
  // hash is of 32 random bytes nobody keeps.
  const { rows: customerRows } = await client.query(
    `INSERT INTO customers (phone, password_hash, full_name, phone_verified_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [customerPhone, hashCustomerPassword(randomBytes(32).toString('hex')), customerName],
  );
  return { agentId, customerId: Number(customerRows[0].id) };
}

/**
 * @returns {Promise<{ok: true, pair: Object} | {ok: false, errorKey: string}>}
 */
export async function createDemoAccount({ label, agentName, agencyName, customerName, deliverTo = null, createdBy = null }) {
  const pool = getPool();
  if (!(await demoTableReady(pool))) return { ok: false, errorKey: 'admin.demo.notReady' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: seq } = await client.query("SELECT nextval(pg_get_serial_sequence('demo_accounts', 'id'))::bigint AS id");
    const id = Number(seq[0].id);
    if (id > 9999) {
      await client.query('ROLLBACK');
      return { ok: false, errorKey: 'admin.demo.errorFull' };
    }
    const { agentPhone, customerPhone } = demoPhonesFor(id);
    const taken = await client.query(
      `SELECT 1 FROM agents WHERE phone = ANY($1::text[])
       UNION ALL SELECT 1 FROM customers WHERE phone = ANY($1::text[]) LIMIT 1`,
      [[agentPhone, customerPhone]],
    );
    if (taken.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, errorKey: 'admin.demo.errorTaken' };
    }
    const { agentId, customerId } = await insertAccounts(client, { agentPhone, customerPhone, agentName, agencyName, customerName });
    await client.query(
      `INSERT INTO demo_accounts (id, label, agent_id, customer_id, agent_phone, customer_phone, deliver_to_phone, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, label, agentId, customerId, agentPhone, customerPhone, deliverTo, createdBy],
    );
    await client.query('COMMIT');
    return { ok: true, pair: await getDemoAccount(id) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateDemoDeliverTo(id, deliverTo) {
  const { rowCount } = await getPool().query(
    'UPDATE demo_accounts SET deliver_to_phone = $2 WHERE id = $1 AND deleted_at IS NULL',
    [Number(id), deliverTo || null],
  );
  return rowCount > 0;
}

// Tables keyed on a listing with no FK to `properties`, beyond the ones
// adminAgentDeletion already clears. Each is skipped when it does not exist.
const EXTRA_LISTING_TABLES = [
  'property_price_history', 'property_status_history', 'featured_listing_days', 'listing_events',
  'team_social_posts', 'market_observations',
];

async function tolerant(client, sql, params) {
  await client.query('SAVEPOINT demo_step');
  try {
    const result = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT demo_step');
    return result.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT demo_step');
    if (['42P01', '42703'].includes(err.code)) return 0; // table / column not there
    throw err;
  }
}

/**
 * Everything both accounts made, in Postgres: the demo agent's listings and
 * their rows, notifications and devices, then the two accounts themselves
 * (their FK-cascade tables go with them). Refuses anything that is not a
 * demo pair's own row.
 */
async function purgePostgres(pair) {
  const pool = getPool();
  const summary = { listings: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (pair.agentId) {
      const { rows } = await client.query(
        'SELECT id, phone FROM agents WHERE id = $1 FOR UPDATE',
        [pair.agentId],
      );
      if (rows[0] && !isDemoPhone(rows[0].phone)) throw new Error(`agent #${pair.agentId} is not a demo agent`);
      const { rows: listings } = await client.query('SELECT id FROM properties WHERE agent_id = $1', [pair.agentId]);
      const ids = listings.map((r) => Number(r.id));
      if (ids.length) {
        for (const table of [...LISTING_CHILD_TABLES, ...EXTRA_LISTING_TABLES]) {
          await tolerant(client, `DELETE FROM ${table} WHERE property_id = ANY($1::bigint[])`, [ids]);
        }
        summary.listings = await tolerant(client, 'DELETE FROM properties WHERE id = ANY($1::bigint[])', [ids]);
      }
      await tolerant(client, 'DELETE FROM developments WHERE agent_id = $1', [pair.agentId]);
      await tolerant(client, "DELETE FROM notifications WHERE user_type = 'agent' AND user_id = $1", [pair.agentId]);
      await tolerant(client, "DELETE FROM push_devices WHERE user_type = 'agent' AND user_id = $1", [pair.agentId]);
      await tolerant(client, "DELETE FROM notification_preferences WHERE user_type = 'agent' AND user_id = $1", [pair.agentId]);
      await tolerant(client, 'DELETE FROM whatsapp_clicks WHERE agent_id = $1', [pair.agentId]);
    }
    if (pair.customerId) {
      const { rows } = await client.query('SELECT phone FROM customers WHERE id = $1', [pair.customerId]);
      if (rows[0] && !isDemoPhone(rows[0].phone)) throw new Error(`customer #${pair.customerId} is not a demo customer`);
      await tolerant(client, "DELETE FROM notifications WHERE user_type = 'customer' AND user_id = $1", [pair.customerId]);
      await tolerant(client, "DELETE FROM push_devices WHERE user_type = 'customer' AND user_id = $1", [pair.customerId]);
      await tolerant(client, "DELETE FROM notification_preferences WHERE user_type = 'customer' AND user_id = $1", [pair.customerId]);
      await tolerant(client, 'DELETE FROM customer_signup_events WHERE customer_id = $1', [pair.customerId]);
      await client.query('DELETE FROM customers WHERE id = $1', [pair.customerId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (pair.agentId) {
    const removed = await deleteAgentAccount(pair.agentId, { listings: 'delete' });
    if (!removed.ok && removed.reason !== 'not_found') throw new Error(`demo agent #${pair.agentId}: ${removed.reason}`);
  }
  return summary;
}

async function purgeEngine(pair) {
  try {
    return await purgeDemoEngineData({
      phones: [pair.agentPhone, pair.customerPhone],
      agentIds: pair.agentId ? [pair.agentId] : [],
    });
  } catch (err) {
    // Postgres is still cleaned; the leftovers stay on demo numbers only.
    console.error(`[demo] engine purge for pair #${pair.id} failed: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * "Réinitialiser": deletes everything both accounts made and recreates them,
 * same numbers, same label. The two new ids replace the old ones.
 */
export async function resetDemoAccount(id, { agentName, agencyName, customerName } = {}) {
  const pair = await getDemoAccount(id);
  if (!pair) return { ok: false, errorKey: 'admin.demo.notFound' };
  const pool = getPool();
  // The names the team gave the accounts survive a reset.
  const { rows: names } = await pool.query(
    `SELECT a.agency_name, CONCAT_WS(' ', ai.first_name, ai.last_name) AS agent_name, c.full_name AS customer_name
       FROM demo_accounts d
       LEFT JOIN agents a ON a.id = d.agent_id
       LEFT JOIN LATERAL (SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY language_id LIMIT 1) ai ON true
       LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.id = $1`,
    [pair.id],
  );
  const kept = names[0] || {};
  const engine = await purgeEngine(pair);
  const postgres = await purgePostgres(pair);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = await insertAccounts(client, {
      agentPhone: pair.agentPhone,
      customerPhone: pair.customerPhone,
      agentName: agentName || String(kept.agent_name || '').trim() || 'Agent démo',
      agencyName: agencyName || String(kept.agency_name || '').trim() || `Agence démo — ${pair.label}`,
      customerName: customerName || String(kept.customer_name || '').trim() || 'Client démo',
    });
    await client.query(
      'UPDATE demo_accounts SET agent_id = $2, customer_id = $3, reset_at = NOW() WHERE id = $1',
      [pair.id, ids.agentId, ids.customerId],
    );
    await client.query('COMMIT');
    return { ok: true, engine, postgres, agentId: ids.agentId, customerId: ids.customerId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** "Supprimer": deletes everything both accounts made, and the two accounts. */
export async function deleteDemoAccount(id) {
  const pair = await getDemoAccount(id);
  if (!pair) return { ok: false, errorKey: 'admin.demo.notFound' };
  const engine = await purgeEngine(pair);
  const postgres = await purgePostgres(pair);
  await getPool().query(
    'UPDATE demo_accounts SET deleted_at = NOW(), agent_id = NULL, customer_id = NULL WHERE id = $1',
    [pair.id],
  );
  return { ok: true, engine, postgres };
}
