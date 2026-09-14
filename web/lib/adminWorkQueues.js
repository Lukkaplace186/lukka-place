import 'server-only';
import { getPool } from './db';
import { getEngineWorkQueueCounts } from './adminApi';

/**
 * "What needs doing right now" — the counts behind the dashboard's work queues
 * and the sidebar badges.
 *
 * Two halves, fetched independently so one being down never blanks the other:
 * Postgres (listings, agents, plans, customers) and the engine's SQLite
 * (viewings, conversations, WhatsApp sends).
 *
 * Cached in-process for 15 seconds. Every open console tab polls these every
 * 30s; without the cache the database would answer the same eight COUNTs once
 * per tab per poll.
 */

const CACHE_MS = 15_000;
let cached = { at: 0, value: null };

const POSTGRES_QUEUES_SQL = `
  SELECT
    (SELECT COUNT(*) FROM properties WHERE approve_status = 0)::int                      AS pending_listings,
    (SELECT MIN(created_at) FROM properties WHERE approve_status = 0)                    AS oldest_pending_at,
    (SELECT COUNT(*) FROM properties WHERE status = 0 AND approve_status = 1)::int       AS suspended_listings,
    (SELECT COUNT(*) FROM agents WHERE phone_verified_at IS NULL AND status = 1)::int    AS unverified_agents,
    (SELECT COUNT(*) FROM plan_change_requests WHERE status = 'pending')::int            AS pending_plan_requests,
    (SELECT COUNT(*) FROM customers WHERE locked_until > NOW())::int                     AS locked_customers,
    (SELECT COUNT(*) FROM memberships
      WHERE status = 1 AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14)::int   AS expiring_memberships
`;

export async function getWorkQueueCounts({ fresh = false } = {}) {
  if (!fresh && cached.value && Date.now() - cached.at < CACHE_MS) return cached.value;

  const [pg, engine] = await Promise.allSettled([
    getPool().query(POSTGRES_QUEUES_SQL).then((r) => r.rows[0]),
    getEngineWorkQueueCounts(),
  ]);
  const p = pg.status === 'fulfilled' ? pg.value : null;
  const e = engine.status === 'fulfilled' ? engine.value?.counts : null;

  const value = {
    pendingListings: p?.pending_listings ?? null,
    oldestPendingAt: p?.oldest_pending_at ?? null,
    suspendedListings: p?.suspended_listings ?? null,
    unverifiedAgents: p?.unverified_agents ?? null,
    pendingPlanRequests: p?.pending_plan_requests ?? null,
    lockedCustomers: p?.locked_customers ?? null,
    expiringMemberships: p?.expiring_memberships ?? null,
    escalatedViewings: e?.escalatedViewings ?? null,
    awaitingAgent: e?.awaitingAgent ?? null,
    pendingViewings: e?.pendingViewings ?? null,
    humanConversations: e?.humanConversations ?? null,
    failedPushes24h: e?.failedPushes24h ?? null,
    newLeads24h: e?.newLeads24h ?? null,
    openAlerts: e?.openAlerts ?? null,
    postgresError: pg.status === 'rejected' ? pg.reason?.message || 'unavailable' : null,
    engineError: engine.status === 'rejected' ? engine.reason?.message || 'unavailable' : null,
    at: new Date().toISOString(),
  };
  cached = { at: Date.now(), value };
  return value;
}
