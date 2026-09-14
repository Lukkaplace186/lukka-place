import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { ADMIN_AGENT_SORTS, findDuplicateAgents, getVendors, listAgentsForAdmin } from '@/lib/agents';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { firstParam, parseCursor, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { ErrorNote, Stat } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import ServerViewTools from '../table/ServerViewTools';
import AgentsTable from './AgentsTable';
import { toAgentTableRows } from './agentRows';

export const dynamic = 'force-dynamic';

const SORT_LABEL_KEYS = {
  newest: 'admin.agents.sortNewest',
  name: 'admin.agents.sortName',
  listings: 'admin.agents.sortListings',
  live: 'admin.agents.sortLive',
};

/**
 * The agent directory, built for tens of thousands of rows: one server page
 * (LIMIT/OFFSET) per request, searched on name, agency, email, any fragment of
 * the phone digits, or `#id`; filtered by verification and status; sorted by
 * recency, name or portfolio size; bulk activate/suspend; saved views; CSV.
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
    listAgentsForAdmin({ ...filters, limit, offset, cursor: parseCursor(raw) }),
    getVendors(),
    findDuplicateAgents(),
  ]);
  const list = listResult.status === 'fulfilled' ? listResult.value : null;
  const vendors = vendorsResult.status === 'fulfilled' ? vendorsResult.value : [];
  const duplicates = duplicatesResult.status === 'fulfilled' ? duplicatesResult.value : [];

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
      >
        <ServerViewTools path="/admin/agents" params={params} exportDataset="agents" />
      </TableToolbar>

      {listResult.status === 'rejected' ? (
        <ErrorNote>{t('admin.agents.loadError', { error: listResult.reason?.message })}</ErrorNote>
      ) : null}

      <AgentsTable
        rows={toAgentTableRows(list?.rows)}
        vendors={vendors.map((vendor) => ({ id: vendor.id, username: vendor.name }))}
        footer={list ? <Pagination pathname="/admin/agents" params={params} total={list.total} page={page} pageSize={pageSize} cursors={list.cursors} /> : null}
      />
    </div>
  );
}
