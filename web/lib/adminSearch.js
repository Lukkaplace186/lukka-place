import 'server-only';
import { getPool } from './db';
import { listConversations } from './adminApi';
import { searchAgentsForAdmin } from './agents';
import { can } from './adminRoles';

/**
 * The console's global search. Each group is a small, bounded, indexed query
 * (pg_trgm GIN indexes back every `%term%` here — see
 * migrations/20260914_admin_console_platform.sql), run in parallel, and only
 * for the sections the searching role may open. A group that fails is dropped
 * rather than failing the whole search.
 */

function like(term) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function searchListings(term) {
  const id = /^#?\d+$/.test(term) ? Number.parseInt(term.replace('#', ''), 10) : -1;
  const { rows } = await getPool().query(
    `SELECT p.id, p.reference, p.approve_status, p.status, pc.title
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.id = $1 OR p.reference ILIKE $2 OR pc.title ILIKE $2
     ORDER BY (p.id = $1) DESC, p.created_at DESC
     LIMIT 6`,
    [id, like(term)],
  );
  return rows.map((row) => ({
    href: `/admin/listings/${row.id}`,
    title: row.title || `#${row.id}`,
    subtitle: [`#${row.id}`, row.reference ? `Réf. ${row.reference}` : null].filter(Boolean).join(' · '),
  }));
}

async function searchCustomers(term) {
  const digits = term.replace(/\D/g, '');
  const { rows } = await getPool().query(
    `SELECT id, phone, full_name FROM customers
     WHERE COALESCE(full_name, '') ILIKE $1 OR ($2 <> '' AND phone LIKE $3)
     ORDER BY created_at DESC LIMIT 5`,
    [like(term), digits, `%${digits}%`],
  );
  return rows.map((row) => ({
    href: `/admin/customers/${row.id}`,
    title: row.full_name || `+${row.phone}`,
    subtitle: `+${row.phone}`,
  }));
}

async function searchAgencies(term) {
  const { rows } = await getPool().query(
    `SELECT v.id, v.username, v.email, (SELECT COUNT(*)::int FROM agents a WHERE a.vendor_id = v.id) AS agents
     FROM vendors v WHERE v.username ILIKE $1 OR COALESCE(v.email, '') ILIKE $1
     ORDER BY v.username LIMIT 4`,
    [like(term)],
  );
  return rows.map((row) => ({
    href: `/admin/agencies/${row.id}`,
    title: row.username,
    subtitle: `${row.agents} agent(s)${row.email ? ` · ${row.email}` : ''}`,
  }));
}

async function searchAgents(term) {
  const agents = await searchAgentsForAdmin({ q: term, limit: 6 });
  return agents.map((agent) => ({
    href: `/admin/agents/${agent.id}`,
    title: agent.name,
    subtitle: [agent.phone ? `+${agent.phone}` : null, `#${agent.id}`].filter(Boolean).join(' · '),
  }));
}

async function searchConversations(term) {
  const digits = term.replace(/\D/g, '');
  if (digits.length < 4) return [];
  const page = await listConversations({ q: digits, limit: 5 });
  return (page.data || []).map((row) => ({
    href: `/admin/conversations?c=${row.id}`,
    title: `+${row.wa_id}`,
    subtitle: [row.commune, row.last_message].filter(Boolean).join(' · ').slice(0, 90),
  }));
}

export async function adminGlobalSearch(query, role) {
  const term = String(query || '').trim().slice(0, 80);
  if (term.length < 2) return [];

  const plan = [
    ['listings', 'listings.view', searchListings],
    ['agents', 'agents.view', searchAgents],
    ['agencies', 'agents.view', searchAgencies],
    ['customers', 'customers.view', searchCustomers],
    ['conversations', 'leads.view', searchConversations],
  ].filter(([, permission]) => can(role, permission));

  const settled = await Promise.allSettled(plan.map(([, , run]) => run(term)));
  return plan
    .map(([key], index) => ({ key, items: settled[index].status === 'fulfilled' ? settled[index].value : [] }))
    .filter((group) => group.items.length > 0);
}
