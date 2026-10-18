import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool } from './db';
import { cleanIds, undoStillOpen } from './adminSoftDeleteRules';

/**
 * Bulk "Supprimer la sélection" for agents, agencies and listings, with an
 * undo (migrations/20261018_admin_soft_delete.sql).
 *
 * A soft delete, never a hard one: each row gets `deleted_at` (every console
 * list skips it) and `status = 0` (off the storefront and out of every engine
 * read that gates on status). Its previous status goes into
 * `console_soft_deletions`, so an undo restores exactly what was there.
 *
 * Cascade: an agency takes its agents, an agent takes their listings. A row
 * already deleted is left alone (and not re-logged), so undoing a later batch
 * never resurrects something an earlier batch removed.
 *
 * The permanent, owner-only deletion with its impact dialog
 * (lib/adminAgentDeletion.js) is unchanged and separate.
 */

async function inTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function log(client, batchId, entityType, rows, { root, actor }) {
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO console_soft_deletions (batch_id, entity_type, entity_id, root, previous_status, deleted_by)
     SELECT $1, $2, x.id, $3, x.status, $4
     FROM UNNEST($5::bigint[], $6::int[]) AS x(id, status)`,
    [batchId, entityType, root, actor, rows.map((r) => r.id), rows.map((r) => (r.status == null ? null : Number(r.status)))],
  );
}

async function deleteListingRows(client, batchId, ids, { root, actor }) {
  const { rows } = await client.query(
    'SELECT id, status FROM properties WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
    [ids],
  );
  await log(client, batchId, 'listing', rows, { root, actor });
  if (rows.length) {
    await client.query('UPDATE properties SET deleted_at = NOW(), deleted_by = $2, status = 0 WHERE id = ANY($1::bigint[])', [rows.map((r) => r.id), actor]);
  }
  return rows.length;
}

async function deleteAgentRows(client, batchId, ids, { root, actor }) {
  const { rows } = await client.query(
    'SELECT id, status FROM agents WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
    [ids],
  );
  if (rows.length === 0) return { agents: 0, listings: 0 };
  const agentIds = rows.map((r) => r.id);
  const { rows: listingRows } = await client.query(
    'SELECT id FROM properties WHERE agent_id = ANY($1::bigint[]) AND deleted_at IS NULL',
    [agentIds],
  );
  const listings = await deleteListingRows(client, batchId, listingRows.map((r) => r.id), { root: false, actor });
  await log(client, batchId, 'agent', rows, { root, actor });
  await client.query('UPDATE agents SET deleted_at = NOW(), deleted_by = $2, status = 0 WHERE id = ANY($1::bigint[])', [agentIds, actor]);
  return { agents: rows.length, listings };
}

/**
 * @param {'listing'|'agent'|'agency'} entity
 * @param {number[]} ids the selected records
 * @param {string} actor actorLabel(session)
 * @returns {Promise<{batchId: string, deleted: number, cascadedAgents: number, cascadedListings: number}>}
 */
export async function softDelete(entity, ids, actor) {
  const clean = cleanIds(ids);
  if (!clean) throw new Error('invalid selection');
  const batchId = randomUUID();
  return inTransaction(async (client) => {
    if (entity === 'listing') {
      const deleted = await deleteListingRows(client, batchId, clean, { root: true, actor });
      return { batchId, deleted, cascadedAgents: 0, cascadedListings: 0 };
    }
    if (entity === 'agent') {
      const { agents, listings } = await deleteAgentRows(client, batchId, clean, { root: true, actor });
      return { batchId, deleted: agents, cascadedAgents: 0, cascadedListings: listings };
    }
    if (entity === 'agency') {
      const { rows } = await client.query(
        'SELECT id, status FROM vendors WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
        [clean],
      );
      if (rows.length === 0) return { batchId, deleted: 0, cascadedAgents: 0, cascadedListings: 0 };
      const vendorIds = rows.map((r) => r.id);
      const { rows: agentRows } = await client.query(
        'SELECT id FROM agents WHERE vendor_id = ANY($1::bigint[]) AND deleted_at IS NULL',
        [vendorIds],
      );
      const { agents, listings } = await deleteAgentRows(client, batchId, agentRows.map((r) => r.id), { root: false, actor });
      await log(client, batchId, 'agency', rows, { root: true, actor });
      await client.query('UPDATE vendors SET deleted_at = NOW(), deleted_by = $2, status = 0 WHERE id = ANY($1::bigint[])', [vendorIds, actor]);
      return { batchId, deleted: rows.length, cascadedAgents: agents, cascadedListings: listings };
    }
    throw new Error('unknown entity');
  });
}

const TABLE = { listing: 'properties', agent: 'agents', agency: 'vendors' };

/**
 * Undo one batch, inside UNDO_GRACE_MS of its delete. Each row gets its
 * previous status back and `deleted_at` cleared. A row whose `deleted_at` no
 * longer matches the batch is skipped.
 * @returns {Promise<{ok: true, restored: number} | {ok: false, reason: 'not_found'|'expired'|'already_restored'}>}
 */
export async function restoreBatch(batchId, actor) {
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, entity_type, entity_id, previous_status, deleted_at, restored_at FROM console_soft_deletions WHERE batch_id = $1 FOR UPDATE',
      [batchId],
    );
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    if (rows.every((r) => r.restored_at)) return { ok: false, reason: 'already_restored' };
    if (!undoStillOpen(rows[0].deleted_at)) return { ok: false, reason: 'expired' };

    let restored = 0;
    for (const [entityType, table] of Object.entries(TABLE)) {
      // Matched in SQL, not through a JS Date: Postgres keeps microseconds,
      // a Date keeps milliseconds, and the equality would never hold.
      const { rowCount } = await client.query(
        `UPDATE ${table} t SET deleted_at = NULL, deleted_by = NULL, status = COALESCE(d.previous_status, 0)
         FROM console_soft_deletions d
         WHERE d.batch_id = $1 AND d.entity_type = $2 AND d.restored_at IS NULL
           AND t.id = d.entity_id AND t.deleted_at = d.deleted_at`,
        [batchId, entityType],
      );
      restored += rowCount;
    }
    await client.query('UPDATE console_soft_deletions SET restored_at = NOW(), restored_by = $2 WHERE batch_id = $1 AND restored_at IS NULL', [batchId, actor]);
    return { ok: true, restored };
  });
}
