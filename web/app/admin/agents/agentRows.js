import { formatRelative } from '@/lib/format';

/**
 * Shapes `listAgentsForAdmin` rows into the plain, pre-formatted props the
 * client AgentsTable renders — no Date objects cross the server/client
 * boundary, so both render identical text. Shared by /admin/agents and
 * /admin/agencies/[id].
 */

function formatDay(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kinshasa' }).format(date);
}

const KINSHASA_TIME = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa',
});

/** "24 oct., 06:15" in Kinshasa time, whatever the server's own zone. */
export function formatKinshasaTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : KINSHASA_TIME.format(date);
}

/**
 * The "Dernière connexion" cell, pre-formatted (lib/agentLoginLog.js
 * getLoginSummaries). null = no attempt on record.
 */
export function loginCell(summary, locale = 'fr') {
  if (!summary) return null;
  return {
    lastOutcome: summary.lastOutcome,
    lastAt: formatKinshasaTime(summary.lastAttemptAt),
    lastAgo: formatRelative(summary.lastAttemptAt instanceof Date ? summary.lastAttemptAt : new Date(summary.lastAttemptAt), locale),
    signedInAt: formatKinshasaTime(summary.lastSignedInAt),
    failures: summary.failuresSinceSignIn,
    lastFailureAt: formatKinshasaTime(summary.lastFailureAt),
    pendingVerification: summary.pendingVerification,
  };
}

export function toAgentTableRows(rows = [], loginSummaries = null, locale = 'fr') {
  return rows.map((agent) => ({
    id: Number(agent.id),
    name: agent.display_name,
    email: agent.email || null,
    phone: agent.phone || null,
    verified: Boolean(agent.phone_verified_at),
    routingEnabled: agent.direct_routing_enabled !== false,
    vendorId: agent.vendor_id ?? null,
    agency: agent.vendor_name || null,
    primary: agent.primary_communes || [],
    serviced: agent.serviced_communes || [],
    live: agent.live_listing_count ?? 0,
    total: agent.listing_count ?? 0,
    limit: agent.listing_limit ?? null,
    packageTitle: agent.package_title || null,
    expireLabel: formatDay(agent.expire_date),
    status: agent.status,
    branchId: agent.branch_id != null ? Number(agent.branch_id) : null,
    branchName: agent.branch_name || null,
    // undefined = this page did not load sign-in history (the column is not
    // drawn); null = loaded, nothing on record.
    login: loginSummaries ? loginCell(loginSummaries.get(Number(agent.id)), locale) : undefined,
  }));
}
