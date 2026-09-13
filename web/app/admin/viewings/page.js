import Link from 'next/link';
import { listViewingFeed } from '@/lib/adminApi';
import { getAgentsForRouting, getListingLabels } from '@/lib/adminLeadRouting';
import {
  DECLINE_REASON_LABEL_KEYS,
  ROUTING_TYPES,
  ROUTING_TYPE_LABEL_KEYS,
  VIEWING_REQUEST_STATUSES,
  VIEWING_REQUEST_STATUS_LABEL_KEYS,
} from '@/lib/adminLabels';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Panel, ROUTING_TONE, STATUS_TONE, TD, TH, formatKinshasa } from '../LeadRoutingUI';
import ViewingRowActions from './ViewingRowActions';

export const metadata = {
  title: 'Visites — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const FILTER_LINK =
  'u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors';

/**
 * Live lead & viewing feed — every viewing request across both routing paths.
 *
 * `routing_type` is what actually happened when the request was created
 * (services/viewingNotifications.js): DIRECT_WA when a verified agent was
 * alerted, CENTRAL_FALLBACK when only the desk could be. A request that
 * predates routing being recorded shows as "not routed" rather than being
 * guessed into either bucket.
 */
export default async function AdminViewingsPage({ searchParams }) {
  const t = await getT();
  const params = (await searchParams) || {};
  const status = VIEWING_REQUEST_STATUSES.includes(params.status) ? params.status : undefined;
  const routing = ROUTING_TYPES.includes(params.routing) ? params.routing : undefined;

  let feed = null;
  let loadError = null;
  try {
    feed = await listViewingFeed({ status, routingType: routing, limit: 100 });
  } catch (err) {
    loadError = err.message;
  }

  const rows = feed?.data || [];
  const [labels, agents] = await Promise.all([
    getListingLabels(rows.map((row) => row.property_id)).catch(() => new Map()),
    getAgentsForRouting().catch(() => []),
  ]);
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const routable = agents
    .filter((agent) => agent.phoneVerified && agent.directRoutingEnabled)
    .map((agent) => ({ id: agent.id, name: agent.name }));
  const byStatus = feed?.summary?.byStatus || {};
  const byRouting = feed?.summary?.byRouting || {};
  const allCount = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  const hrefFor = (next) => {
    const query = new URLSearchParams();
    const nextStatus = 'status' in next ? next.status : status;
    const nextRouting = 'routing' in next ? next.routing : routing;
    if (nextStatus) query.set('status', nextStatus);
    if (nextRouting) query.set('routing', nextRouting);
    const qs = query.toString();
    return `/admin/viewings${qs ? `?${qs}` : ''}`;
  };
  const filterClass = (active) =>
    `${FILTER_LINK} ${active ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.viewings.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.viewings.subtitle')}</p>
      </div>

      {loadError ? <ErrorNote>{t('admin.viewings.loadError', { error: loadError })}</ErrorNote> : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Link href={hrefFor({ status: undefined })} className={filterClass(!status)}>
            {t('admin.viewings.all')} <span className="u-tabular text-ink-45">{allCount}</span>
          </Link>
          {VIEWING_REQUEST_STATUSES.map((value) => (
            <Link key={value} href={hrefFor({ status: value })} className={filterClass(status === value)}>
              {t(VIEWING_REQUEST_STATUS_LABEL_KEYS[value])}
              <span className="u-tabular text-ink-45">{byStatus[value] || 0}</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={hrefFor({ routing: undefined })} className={filterClass(!routing)}>
            {t('admin.viewings.allRoutes')}
          </Link>
          {ROUTING_TYPES.map((value) => (
            <Link key={value} href={hrefFor({ routing: value })} className={filterClass(routing === value)}>
              {t(ROUTING_TYPE_LABEL_KEYS[value])}
              <span className="u-tabular text-ink-45">{byRouting[value] || 0}</span>
            </Link>
          ))}
        </div>
      </div>

      <Panel
        title={t('admin.viewings.tableTitle')}
        isEmpty={rows.length === 0}
        emptyText={t('admin.viewings.empty')}
      >
        <table className="w-full min-w-[68rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.viewings.colListing')}</th>
              <th className={TH}>{t('admin.viewings.colClient')}</th>
              <th className={TH}>{t('admin.viewings.colReceived')}</th>
              <th className={TH}>{t('admin.viewings.colRouting')}</th>
              <th className={TH}>{t('admin.viewings.colAgent')}</th>
              <th className={TH}>{t('admin.viewings.colStatus')}</th>
              <th className={TH}>{t('admin.viewings.colSlot')}</th>
              <th className={TH}>{t('admin.viewings.colReason')}</th>
              <th className={TH}>{t('admin.viewings.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const listing = labels.get(Number(row.property_id));
              const agentId = row.agent_id ? Number(row.agent_id) : null;
              return (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className={TD}>
                    {row.property_id ? (
                      <Link href={`/admin/listings/${row.property_id}`} className="font-semibold text-blue-deep hover:underline">
                        {listing?.reference ? `Réf: ${listing.reference}` : `#${row.property_id}`}
                      </Link>
                    ) : '—'}
                    {listing?.title ? <div className="max-w-[16rem] truncate text-ink-45">{listing.title}</div> : null}
                    <div className="u-tabular text-ink-35">#{row.id}</div>
                  </td>
                  <td className={TD}>
                    <div className="text-ink">{row.lead_name || '—'}</div>
                    <div className="u-tabular text-ink-45">{row.lead_wa_id ? `+${row.lead_wa_id}` : ''}</div>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD}>
                    {row.routing_type ? (
                      <Chip tone={ROUTING_TONE[row.routing_type]}>{t(ROUTING_TYPE_LABEL_KEYS[row.routing_type])}</Chip>
                    ) : (
                      <span className="text-ink-35">{t('admin.viewings.notRouted')}</span>
                    )}
                  </td>
                  <td className={TD}>
                    {agentId ? (agentNames.get(agentId) || `#${agentId}`) : '—'}
                    {row.reassigned_at ? (
                      <div className="mt-1"><Chip>{t('admin.viewings.reassignedChip')}</Chip></div>
                    ) : null}
                  </td>
                  <td className={TD}>
                    <Chip tone={STATUS_TONE[row.status]}>
                      {VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status] ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status]) : row.status}
                    </Chip>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.scheduled_at ? formatKinshasa(row.scheduled_at) : (row.requested_time || '—')}
                  </td>
                  <td className={TD}>
                    {row.decline_reason_code ? (
                      <>
                        <div className="text-ink">{t(DECLINE_REASON_LABEL_KEYS[row.decline_reason_code])}</div>
                        <div className="text-ink-45">
                          {row.decline_reason_by === 'CUSTOMER' ? t('admin.viewings.byCustomer') : t('admin.viewings.byAgent')}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td className={TD}>
                    <ViewingRowActions
                      viewingRequestId={row.id}
                      agents={routable}
                      currentAgentId={agentId}
                      canNudge={row.routing_type === 'DIRECT_WA' && ['PENDING', 'RESCHEDULED'].includes(row.status)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
