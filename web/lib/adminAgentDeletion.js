import 'server-only';
import { getPool } from './db';
import { removeVerificationFiles } from './agentVerification';

/**
 * Permanently deleting an agent account from /admin/agents — the "Supprimer"
 * beside "Suspendre". Suspending is still the reversible answer; this is for a
 * duplicate, a test account, or someone who asked to be removed.
 *
 * WHAT HAPPENS TO EACH THING THAT POINTS AT THE AGENT (checked against the
 * live schema, 2026-09-21):
 *
 *   agency_branch_agents, agent_performance_logs,        ON DELETE CASCADE —
 *   agent_verification_documents,                         Postgres removes them.
 *   sales_account_assignments, sales_agent_attributions   The ID documents are
 *                                                          also removed from the
 *                                                          private bucket.
 *   agent_infos, plan_change_requests, property_contacts   deleted here (no FK)
 *   projects, whatsapp_clicks                               agent_id set to NULL:
 *                                                          the tap stays in the
 *                                                          traffic stats.
 *   properties                                              see LISTINGS below
 *   sales_commissions / _listing_credits /                  kept as the audit
 *   _attribution_changes / _referral_refusals               trail they are
 *
 * The agency (vendors row) and its memberships are NOT touched: a membership
 * belongs to the agency, not to one of its agents.
 *
 * LISTINGS. The admin chooses:
 *   'archive' (default) — every listing is taken off the site (status = 0,
 *                         archived_at) and detached from the agent.
 *   'delete'            — listings are removed with their photos, texts and
 *                         amenities, EXCEPT closed transactions: a listing
 *                         with a recorded close is archived and detached
 *                         instead, because asking-vs-achieved exists nowhere
 *                         else and the market export is built on it.
 *
 * REFUSED while the agent has a pending, approved or paid sales commission.
 * Those are money owed or paid to a rep for this agent; they are voided or
 * settled in /admin/sales first, never deleted by a side effect.
 *
 * The engine's SQLite history (viewing requests, intake listings, lead
 * matches) keeps the old id. That is safe because agents.id comes from an
 * identity sequence, which never hands a deleted id to a new signup
 * (migrations/20260921_admin_deletions_and_photo_allowances.sql).
 */

export const LISTING_MODES = Object.freeze(['archive', 'delete']);

const BLOCKING_COMMISSION_STATUSES = ['pending', 'approved', 'paid'];

// Child tables of `properties` with no ON DELETE CASCADE (listing_stats_daily
// and agent_performance_logs do cascade). Same set deleteListing clears, plus
// the ones a customer or a rep can attach to a listing.
const LISTING_CHILD_TABLES = [
  'property_slider_images',
  'property_amenities',
  'property_contents',
  'property_spacifications',
  'property_contacts',
  'customer_favorites',
  'wishlists',
  'featured_properties',
  'saved_search_notifications',
  'sales_listing_credits',
];

const IMPACT_SQL = `
  SELECT a.id, a.phone,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), NULLIF(TRIM(a.agency_name), ''), 'Agent #' || a.id) AS name,
         (SELECT count(*) FROM properties p WHERE p.agent_id = a.id)::int AS listings,
         (SELECT count(*) FROM properties p WHERE p.agent_id = a.id AND p.status = 1 AND p.approve_status = 1)::int AS live_listings,
         (SELECT count(*) FROM properties p WHERE p.agent_id = a.id AND p.listing_status = 'closed')::int AS closed_listings,
         (SELECT count(*) FROM agent_verification_documents d WHERE d.agent_id = a.id)::int AS documents,
         (SELECT count(*) FROM sales_commissions sc
           WHERE sc.agent_id = a.id AND sc.status = ANY($2::text[]))::int AS blocking_commissions
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id
    ORDER BY (language_id = 20) DESC, language_id LIMIT 1
  ) ai ON true
  WHERE a.id = $1`;

/** What deleting this agent would touch — shown in the confirmation dialog. */
export async function getAgentDeletionImpact(agentId) {
  const { rows } = await getPool().query(IMPACT_SQL, [Number(agentId), BLOCKING_COMMISSION_STATUSES]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone || null,
    listings: row.listings,
    liveListings: row.live_listings,
    closedListings: row.closed_listings,
    documents: row.documents,
    blockingCommissions: row.blocking_commissions,
  };
}

/**
 * @param {number} agentId
 * @param {{listings?: 'archive'|'delete', dryRun?: boolean}} [options]  `dryRun` runs
 *   every statement and then rolls back — how the real schema is checked for
 *   constraint errors without deleting anybody.
 * @returns {Promise<{ok: true, summary: object}|{ok: false, reason: 'not_found'|'commissions'|'bad_mode', count?: number}>}
 */
export async function deleteAgentAccount(agentId, { listings = 'archive', dryRun = false } = {}) {
  if (!LISTING_MODES.includes(listings)) return { ok: false, reason: 'bad_mode' };
  const id = Number(agentId);
  const client = await getPool().connect();
  let storagePaths = [];
  let summary;

  try {
    await client.query('BEGIN');

    const { rows: found } = await client.query('SELECT id, phone FROM agents WHERE id = $1 FOR UPDATE', [id]);
    if (!found.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    const { rows: owed } = await client.query(
      'SELECT count(*)::int AS n FROM sales_commissions WHERE agent_id = $1 AND status = ANY($2::text[])',
      [id, BLOCKING_COMMISSION_STATUSES],
    );
    if (owed[0].n > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'commissions', count: owed[0].n };
    }

    const { rows: docs } = await client.query(
      'SELECT storage_path FROM agent_verification_documents WHERE agent_id = $1',
      [id],
    );
    storagePaths = docs.map((doc) => doc.storage_path);

    let deletedListings = 0;
    if (listings === 'delete') {
      const { rows: doomed } = await client.query(
        `SELECT id FROM properties
          WHERE agent_id = $1 AND listing_status IS DISTINCT FROM 'closed'
          FOR UPDATE`,
        [id],
      );
      const ids = doomed.map((row) => Number(row.id));
      if (ids.length) {
        for (const table of LISTING_CHILD_TABLES) {
          await client.query(`DELETE FROM ${table} WHERE property_id = ANY($1::bigint[])`, [ids]);
        }
        const { rowCount } = await client.query('DELETE FROM properties WHERE id = ANY($1::bigint[])', [ids]);
        deletedListings = rowCount;
      }
    }

    // Everything still attached: every listing in 'archive' mode, the closed
    // transactions in 'delete' mode.
    const { rowCount: archivedListings } = await client.query(
      `UPDATE properties
          SET agent_id = NULL, status = 0, archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
        WHERE agent_id = $1`,
      [id],
    );

    await client.query('DELETE FROM property_contacts WHERE agent_id = $1', [id]);
    await client.query('DELETE FROM plan_change_requests WHERE agent_id = $1', [id]);
    await client.query('UPDATE projects SET agent_id = NULL WHERE agent_id = $1', [id]);
    await client.query('UPDATE whatsapp_clicks SET agent_id = NULL WHERE agent_id = $1', [id]);
    await client.query('DELETE FROM agent_infos WHERE agent_id = $1', [id]);
    await client.query('DELETE FROM agents WHERE id = $1', [id]);

    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    summary = { deletedListings, archivedListings, documents: storagePaths.length, listingMode: listings, dryRun };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // After the commit: a bucket failure must not resurrect the account, and a
  // rolled-back delete must not have destroyed the files.
  if (dryRun) return { ok: true, summary: { ...summary, documentFilesLeft: 0 } };
  const refused = await removeVerificationFiles(storagePaths);
  if (refused) console.error(`[agent-delete] agent #${id}: ${refused} document file(s) left in the bucket`);
  return { ok: true, summary: { ...summary, documentFilesLeft: refused } };
}
