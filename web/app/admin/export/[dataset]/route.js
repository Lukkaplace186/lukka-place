import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { recordAudit, listAuditLog } from '@/lib/adminAudit';
import { rowsToCsv } from '@/lib/csv';
import { decodeCursor, kinshasaDayEnd, kinshasaDayStart } from '@/lib/adminPagination';
import { listAgentsForAdmin, searchAgentIds } from '@/lib/agents';
import { adminListCustomersPage } from '@/lib/customers';
import { listModerationQueue } from '@/lib/moderationQueue';
import { listAgenciesForAdmin } from '@/lib/adminAgencies';
import { listMembershipsForAdmin } from '@/lib/adminBilling';
import { listConversations, listLeadMatches, listViewingFeed } from '@/lib/adminApi';

export const dynamic = 'force-dynamic';

/**
 * CSV export of any console table, with the same filters the table was showing
 * (the page's own query string), up to EXPORT_CAP rows. Every dataset reads its
 * data through the same bounded list function its page uses, a page at a time,
 * so an export is never one unbounded query. Each download is audited.
 */
const EXPORT_CAP = 10000;
const PAGE = 100;

async function collect(fetchPage) {
  const rows = [];
  let offset = 0;
  let cursor = null;
  for (;;) {
    const { rows: batch, total, cursors } = await fetchPage({ limit: PAGE, offset, cursor });
    rows.push(...batch);
    offset += batch.length;
    if (batch.length < PAGE || offset >= Math.min(total ?? Infinity, EXPORT_CAP)) break;
    // Lists that page by keyset hand back a cursor: follow it, so exporting a
    // table that is being written to (the audit log records this very export)
    // neither repeats nor skips a row, and page 100 costs what page 1 did.
    const next = decodeCursor(cursors?.next);
    cursor = next ? { direction: 'after', values: next } : null;
  }
  return rows.slice(0, EXPORT_CAP);
}

const iso = (value) => (value ? new Date(value).toISOString() : '');

const DATASETS = {
  agents: {
    permission: 'data.export',
    fetch: (p) => collect(({ limit, offset, cursor }) => listAgentsForAdmin({ q: p.get('q'), verified: p.get('verified'), status: p.get('status'), sort: p.get('sort') || 'newest', limit, offset, cursor })),
    columns: [
      ['id', (r) => r.id], ['name', (r) => r.display_name], ['email', (r) => r.email], ['phone', (r) => r.phone],
      ['phone_verified', (r) => Boolean(r.phone_verified_at)], ['status', (r) => r.status], ['agency', (r) => r.vendor_username],
      ['listings_total', (r) => r.listing_count], ['listings_live', (r) => r.live_listing_count], ['package', (r) => r.package_title],
      ['package_expires', (r) => iso(r.expire_date)], ['primary_communes', (r) => (r.primary_communes || []).join('|')], ['created_at', (r) => iso(r.created_at)],
    ],
  },
  customers: {
    permission: 'data.export',
    fetch: (p) => collect(({ limit, offset, cursor }) => adminListCustomersPage({ q: p.get('q'), status: p.get('status'), limit, offset, cursor })),
    columns: [
      ['id', (r) => r.id], ['name', (r) => r.full_name], ['phone', (r) => r.phone], ['joined', (r) => iso(r.created_at)],
      ['last_login', (r) => iso(r.last_login_at)], ['verified', (r) => Boolean(r.phone_verified_at)], ['locked', (r) => r.is_locked],
      ['saved_searches', (r) => r.saved_searches_count], ['favorites', (r) => r.favorites_count],
    ],
  },
  listings: {
    permission: 'data.export',
    fetch: (p) => collect(({ limit, offset, cursor }) => listModerationQueue({
      status: p.get('status') || 'pending', q: p.get('q'), commune: p.get('commune'), purpose: p.get('purpose'), flag: p.get('flag'), sort: p.get('sort'), limit, offset, cursor,
    })),
    columns: [
      ['id', (r) => r.id], ['title', (r) => r.title], ['reference', (r) => r.reference], ['price', (r) => r.price], ['purpose', (r) => r.purpose],
      ['commune', (r) => r.commune], ['agent_id', (r) => r.agentId], ['agent', (r) => r.agentName], ['agent_verified', (r) => r.agentVerified],
      ['photos', (r) => r.photoCount], ['flags', (r) => r.flags.join('|')], ['created_at', (r) => r.createdAt],
      ['moderated_at', (r) => r.moderatedAt], ['moderated_by', (r) => r.moderatedByName], ['reason', (r) => r.moderationReasonCode],
    ],
  },
  agencies: {
    permission: 'data.export',
    fetch: (p) => collect(({ limit, offset }) => listAgenciesForAdmin({ q: p.get('q'), plan: p.get('plan'), sort: p.get('sort') || 'name', limit, offset })),
    columns: [
      ['id', (r) => r.id], ['agency', (r) => r.username], ['email', (r) => r.email], ['phone', (r) => r.phone], ['agents', (r) => r.agents],
      ['verified_agents', (r) => r.verified_agents], ['live_listings', (r) => r.live_listings], ['pending_listings', (r) => r.pending_listings],
      ['package', (r) => r.package_title], ['expires', (r) => iso(r.expire_date)],
    ],
  },
  memberships: {
    permission: 'billing.view',
    fetch: (p) => collect(({ limit, offset }) => listMembershipsForAdmin({ view: p.get('view') || 'all', q: p.get('q'), packageId: p.get('package'), limit, offset })),
    columns: [
      ['id', (r) => r.id], ['agency', (r) => r.agency_name], ['package', (r) => r.package_title], ['price', (r) => r.price], ['currency', (r) => r.currency],
      ['trial', (r) => Boolean(r.is_trial)], ['payment_method', (r) => r.payment_method], ['transaction_id', (r) => r.transaction_id],
      ['start', (r) => iso(r.start_date)], ['expire', (r) => iso(r.expire_date)], ['status', (r) => r.status], ['recorded_at', (r) => iso(r.created_at)],
    ],
  },
  audit: {
    permission: 'audit.view',
    fetch: (p) => collect(({ limit, offset, cursor }) => listAuditLog({
      adminUserId: p.get('actor') || undefined, action: p.get('action') ? `${p.get('action')}.` : undefined, entityType: p.get('entity') || undefined,
      entityId: p.get('q') || undefined, from: kinshasaDayStart(p.get('from')), to: kinshasaDayEnd(p.get('to')), limit, offset, cursor,
    })),
    columns: [
      ['id', (r) => r.id], ['at', (r) => iso(r.created_at)], ['actor', (r) => r.admin_name || r.actor_label], ['action', (r) => r.action],
      ['entity_type', (r) => r.entity_type], ['entity_id', (r) => r.entity_id], ['details', (r) => r.details], ['ip', (r) => r.ip],
    ],
  },
  viewings: {
    permission: 'data.export',
    fetch: async (p) => {
      const statusParam = p.get('status');
      const agentIds = p.get('q') ? await searchAgentIds(p.get('q')).catch(() => []) : undefined;
      return collect(async ({ limit, offset }) => {
        const page = await listViewingFeed({
          status: statusParam === 'ESCALATED' ? undefined : statusParam || undefined,
          view: statusParam === 'ESCALATED' ? 'escalated' : undefined,
          routingType: p.get('routing') || undefined, q: p.get('q') || undefined, agentIds, commune: p.get('commune') || undefined,
          from: kinshasaDayStart(p.get('from')), to: kinshasaDayEnd(p.get('to')), limit, offset,
        });
        return { rows: page.data, total: page.total };
      });
    },
    columns: [
      ['id', (r) => r.id], ['created_at', (r) => r.created_at], ['listing_id', (r) => r.property_id], ['commune', (r) => r.resolved_commune],
      ['customer', (r) => r.lead_name], ['customer_phone', (r) => r.lead_wa_id], ['status', (r) => r.status], ['routing', (r) => r.routing_type],
      ['agent_id', (r) => r.agent_id], ['scheduled_at', (r) => r.scheduled_at], ['requested_time', (r) => r.requested_time],
      ['sla_alerted_at', (r) => r.sla_alerted_at], ['decline_reason', (r) => r.decline_reason_code],
    ],
  },
  conversations: {
    permission: 'data.export',
    fetch: (p) => collect(async ({ limit, offset }) => {
      const page = await listConversations({ state: p.get('state') || undefined, q: p.get('q') || undefined, aiActive: p.get('ai') || undefined, limit, offset });
      return { rows: page.data, total: page.total };
    }),
    columns: [
      ['id', (r) => r.id], ['customer_phone', (r) => r.wa_id], ['state', (r) => r.state], ['ai_active', (r) => r.ai_active], ['assigned_agent', (r) => r.assigned_agent],
      ['commune', (r) => r.commune], ['messages', (r) => r.message_count], ['last_message_at', (r) => r.last_message_at], ['updated_at', (r) => r.updated_at],
    ],
  },
  'lead-matches': {
    permission: 'data.export',
    fetch: (p) => collect(async ({ limit, offset }) => {
      const page = await listLeadMatches({
        days: Number(p.get('days')) || 30, commune: p.get('commune') || undefined, budgetMin: p.get('budget_min') || undefined,
        budgetMax: p.get('budget_max') || undefined, minScore: p.get('min_score') || undefined, status: p.get('status') || undefined, limit, offset,
      });
      return { rows: page.data, total: page.total };
    }),
    columns: [
      ['id', (r) => r.id], ['lead_id', (r) => r.lead_id], ['customer_phone', (r) => r.lead_wa_id], ['commune', (r) => r.commune],
      ['budget_min', (r) => r.price_min], ['budget_max', (r) => r.price_max], ['agent_id', (r) => r.agent_id], ['rank', (r) => r.rank],
      ['score', (r) => r.score], ['send_status', (r) => r.status], ['proposed_listing', (r) => r.proposed_property_id], ['sent_at', (r) => r.created_at],
    ],
  },
};

export async function GET(request, { params }) {
  const { dataset } = await params;
  const config = DATASETS[dataset];
  if (!config) return new Response('Unknown export', { status: 404 });

  const session = await getAdminSession();
  if (!session) return new Response('Not authenticated', { status: 401 });
  if (!can(session.role, config.permission)) return new Response('Forbidden', { status: 403 });

  const search = new URL(request.url).searchParams;
  let rows;
  try {
    rows = await config.fetch(search);
  } catch (err) {
    console.error(`[admin/export] ${dataset} failed: ${err.message}`);
    return new Response(`Export failed: ${err.message}`, { status: 502 });
  }

  await recordAudit(session, {
    action: `export.${dataset}`,
    entityType: null,
    details: { rows: rows.length, capped: rows.length >= EXPORT_CAP, filters: Object.fromEntries(search.entries()) },
  });

  const filename = `lukka-place-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(rowsToCsv(rows, config.columns), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
