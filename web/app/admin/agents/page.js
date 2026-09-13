import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { ADMIN_AGENT_SORTS, findDuplicateAgents, getVendors, listAgentsForAdmin } from '@/lib/agents';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { firstParam, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { ErrorNote, Stat } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import AgentsTable from './AgentsTable';

export const dynamic = 'force-dynamic';

const SORT_LABEL_KEYS = {
  newest: 'admin.agents.sortNewest',
  name: 'admin.agents.sortName',
  listings: 'admin.agents.sortListings',
  live: 'admin.agents.sortLive',
};

function formatDay(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kinshasa' }).format(date);
}

/**
 * The agent directory, built for tens of thousands of rows.
 *
 * One server page (LIMIT/OFFSET) per request, searched on name, agency, email,
 * any fragment of the phone digits, or `#id`; filtered by verification and
 * status; sorted by recency, name or portfolio size. The old version fetched
 * every agent with two correlated counts each and rendered a full commune
 * checkbox form and an agency <select> into every row.
 *
 * Duplicate detection stays: two real signals only (same normalised number,
 * same email), flagged for review, never merged automatically.
 */
export default async function AdminAgentsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const filters = {
    q: firstParam(raw.q) || undefined,
    verified: ['yes', 'no'].includes(firstParam(raw.verified)) ? firstParam(raw.verified) : undefined,
    status: ['0', '1'].includes(firstParam(raw.status)) ? firstParam(raw.status) : undefined,
    sort: ADMIN_AGENT_SORTS.includes(firstParam(raw.sort)) && firstParam(raw.sort) !== 'newest' ? firstParam(raw.sort) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  const [listResult, vendorsResult, duplicatesResult] = await Promise.allSettled([
    listAgentsForAdmin({ ...filters, limit, offset }),
    getVendors(),
    findDuplicateAgents(),
  ]);
  const list = listResult.status === 'fulfilled' ? listResult.value : null;
  const vendors = vendorsResult.status === 'fulfilled' ? vendorsResult.value : [];
  const duplicates = duplicatesResult.status === 'fulfilled' ? duplicatesResult.value : [];

  // Plain, pre-formatted props for the client table: no Date objects crossing
  // the boundary, so server and browser render identical text.
  const rows = (list?.rows || []).map((agent) => ({
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

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.agents.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.agents.subtitle')}</p>
      </div>

      {list ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label={t('admin.agents.statTotal')} value={list.summary.total.toLocaleString('fr-FR')} />
          <Stat label={t('admin.agents.statVerified')} value={list.summary.verified.toLocaleString('fr-FR')} />
          <Stat label={t('admin.agents.statActive')} value={list.summary.active.toLocaleString('fr-FR')} />
        </div>
      ) : null}

      {duplicates.length > 0 && (
        <details className="rounded-card border border-warning/40 bg-warning-tint p-4">
          <summary className="flex cursor-pointer items-center gap-2">
            <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-warning" />
            <span className="u-title-card text-warning">{t('admin.agents.duplicatesTitle', { count: duplicates.length })}</span>
          </summary>
          <ul className="mt-2.5 flex flex-col gap-2">
            {duplicates.map((group) => (
              <li key={`${group.kind}-${group.key}`} className="u-micro text-ink-70">
                <span className="font-bold text-ink">
                  {group.kind === 'phone' ? t('admin.agents.sameNumber') : t('admin.agents.sameEmail')} : {group.key}
                </span>
                {' — '}
                {group.accounts.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/admin/agents/${a.id}`} className="font-semibold text-blue-deep hover:underline">#{a.id}</Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="u-micro mt-2 text-ink-45">{t('admin.agents.duplicateWarning')}</p>
        </details>
      )}

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.agents.searchPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'verified',
            label: t('admin.agents.phoneVerified'),
            options: [
              { value: 'yes', label: t('admin.agents.verified') },
              { value: 'no', label: t('admin.agents.notVerified') },
            ],
          },
          {
            type: 'select',
            param: 'status',
            label: t('admin.agents.status'),
            options: [
              { value: '1', label: t('admin.agents.statusActive') },
              { value: '0', label: t('admin.agents.statusSuspended') },
            ],
          },
          {
            type: 'select',
            param: 'sort',
            label: t('admin.agents.sortBy'),
            allLabel: t(SORT_LABEL_KEYS.newest),
            options: ADMIN_AGENT_SORTS.filter((value) => value !== 'newest').map((value) => ({ value, label: t(SORT_LABEL_KEYS[value]) })),
          },
        ]}
      />

      {listResult.status === 'rejected' ? (
        <ErrorNote>{t('admin.agents.loadError', { error: listResult.reason?.message })}</ErrorNote>
      ) : null}

      <AgentsTable
        rows={rows}
        vendors={vendors.map((vendor) => ({ id: vendor.id, username: vendor.username }))}
        footer={list ? <Pagination pathname="/admin/agents" params={params} total={list.total} page={page} pageSize={pageSize} /> : null}
      />
    </div>
  );
}
