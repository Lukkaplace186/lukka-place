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

export function toAgentTableRows(rows = []) {
  return rows.map((agent) => ({
    id: Number(agent.id),
    name: agent.display_name,
    email: agent.email || null,
    phone: agent.phone || null,
    verified: Boolean(agent.phone_verified_at),
    routingEnabled: agent.direct_routing_enabled !== false,
    vendorId: agent.vendor_id ?? null,
    agency: agent.vendor_username || null,
    primary: agent.primary_communes || [],
    serviced: agent.serviced_communes || [],
    live: agent.live_listing_count ?? 0,
    total: agent.listing_count ?? 0,
    limit: agent.listing_limit ?? null,
    packageTitle: agent.package_title || null,
    expireLabel: formatDay(agent.expire_date),
    status: agent.status,
  }));
}
