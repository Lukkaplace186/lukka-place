import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getAgentForAdmin } from '@/lib/agents';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getAgentBillingHistory } from '@/lib/subscriptions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { firstParam, parsePage } from '@/lib/adminPagination';
import { listModerationQueue } from '@/lib/moderationQueue';
import { getAgentListingStatusCounts, getAgentPerformanceSummary, listAgentPerformanceLogs } from '@/lib/adminAgentProfile';
import { listLeadMatches, listViewingFeed } from '@/lib/adminApi';
import { ROUTING_TYPE_LABEL_KEYS, VIEWING_REQUEST_STATUS_LABEL_KEYS, LISTING_MODERATION_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { MODERATION_QUEUE_STATUSES } from '@/lib/moderation';
import { listEntityAudit } from '@/lib/adminAudit';
import { listNotes } from '@/lib/adminNotes';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import AgentAdminPanel from './AgentAdminPanel';
import EntityTimeline from '../../EntityTimeline';
import ModerationTable from '../../listings/ModerationTable';
import Pagination from '../../table/Pagination';
import { Chip, ErrorNote, ROUTING_TONE, STATUS_TONE, Stat as PanelStat, formatKinshasa, formatLatency } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../../table/TableFrame';

export const metadata = {
  title: 'Agent — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TABS = ['overview', 'listings', 'activity', 'performance', 'notes'];

function renderTime() {
  return Date.now();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (date.getUTCFullYear() >= 9999) return 'Illimité';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg bg-canvas-alt px-4 py-3">
      <div className="u-eyebrow text-ink-45">{label}</div>
      <div className={`mt-1 text-[1.0625rem] font-bold ${tone || 'text-ink'}`}>{value}</div>
    </div>
  );
}

/**
 * The agent's full profile — everything about one agent in one place, instead
 * of across five tabs: identity and territory, their listings in every
 * moderation state, the requests routed to them, how fast they answer, their
 * plan history, and the team's notes plus every console action taken on them.
 */
export default async function AdminAgentDetailPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const raw = (await searchParams) || {};
  const tab = TABS.includes(firstParam(raw.tab)) ? firstParam(raw.tab) : 'overview';
  const agent = await getAgentForAdmin(id);
  if (!agent) notFound();
  const session = await getAdminSession();
  const base = `/admin/agents/${agent.id}`;

  const displayName =
    [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.agency_name || agent.vendor_username || `Agent #${agent.id}`;

  let content = null;

  if (tab === 'overview') {
    const [{ communes }, billing] = await Promise.all([
      getLocationHierarchyWithFallback(),
      getAgentBillingHistory(agent.vendor_id),
    ]);
    content = (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
        <AgentAdminPanel agent={agent} communes={communes} listingCount={agent.listing_count} />
        <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-6">
          <h2 className="u-title-card text-ink">{t('admin.agentPanel.subscriptionHistory')}</h2>
          {billing.length === 0 ? (
            <p className="u-micro text-ink-45">{t('admin.agentProfile.noBilling')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {billing.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="u-micro-strong truncate text-ink">{row.package_title || '—'}</div>
                    <div className="u-micro text-ink-45">
                      {formatDate(row.start_date)} → {formatDate(row.expire_date)}
                      {row.payment_method ? ` · ${row.payment_method}` : ''}
                    </div>
                  </div>
                  <div className="u-micro u-tabular shrink-0 text-ink-70">
                    {row.price != null ? `${Number(row.price).toLocaleString('fr-FR')} ${row.currency_symbol || '$'}` : '—'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  } else if (tab === 'listings') {
    const status = MODERATION_QUEUE_STATUSES.includes(firstParam(raw.lstatus)) ? firstParam(raw.lstatus) : 'approved';
    const { page, pageSize, limit, offset } = parsePage(raw);
    const listParams = { tab, lstatus: status, page: page > 1 ? String(page) : undefined };
    const [queue, counts] = await Promise.all([
      listModerationQueue({ status, agentId: agent.id, limit, offset }).catch(() => null),
      getAgentListingStatusCounts(agent.id).catch(() => ({})),
    ]);
    content = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {MODERATION_QUEUE_STATUSES.map((value) => (
            <Link
              key={value}
              href={`${base}?tab=listings&lstatus=${value}`}
              scroll={false}
              className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${value === status ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
            >
              {t(LISTING_MODERATION_STATUS_LABEL_KEYS[value])}
              <span className="u-tabular text-ink-45">{counts[value] ?? 0}</span>
            </Link>
          ))}
        </div>
        <ModerationTable
          rows={queue?.rows || []}
          status={status}
          canModerate={can(session?.role, 'listings.moderate')}
          renderedAt={renderTime()}
          footer={queue ? <Pagination pathname={base} params={listParams} total={queue.total} page={page} pageSize={pageSize} /> : null}
        />
      </div>
    );
  } else if (tab === 'activity') {
    const [viewings, matches] = await Promise.allSettled([
      listViewingFeed({ agentIds: [agent.id], limit: 25 }),
      listLeadMatches({ agentId: agent.id, days: 365, limit: 25 }),
    ]);
    const viewingRows = viewings.status === 'fulfilled' ? viewings.value.data : [];
    const matchRows = matches.status === 'fulfilled' ? matches.value.data : [];
    content = (
      <div className="flex flex-col gap-6">
        {viewings.status === 'rejected' || matches.status === 'rejected' ? (
          <ErrorNote>{t('admin.agentProfile.engineError')}</ErrorNote>
        ) : null}
        <section className="flex flex-col gap-2">
          <h2 className="u-title-card text-ink">{t('admin.agentProfile.viewingsTitle')}</h2>
          <TableFrame minWidth="48rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.viewings.colListing')}</th>
                <th className={TH_STICKY}>{t('admin.viewings.colClient')}</th>
                <th className={TH_STICKY}>{t('admin.viewings.colReceived')}</th>
                <th className={TH_STICKY}>{t('admin.viewings.colRouting')}</th>
                <th className={TH_STICKY}>{t('admin.viewings.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {viewingRows.length === 0 ? <EmptyRow colSpan={5}>{t('admin.viewings.empty')}</EmptyRow> : viewingRows.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>{row.property_id ? <Link href={`/admin/listings/${row.property_id}`} className="font-semibold text-blue-deep hover:underline">#{row.property_id}</Link> : '—'}</td>
                  <td className={TD_DENSE}>{row.lead_name || '—'}<div className="u-tabular text-ink-45">{row.lead_wa_id ? `+${row.lead_wa_id}` : ''}</div></td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD_DENSE}>{row.routing_type ? <Chip tone={ROUTING_TONE[row.routing_type]}>{t(ROUTING_TYPE_LABEL_KEYS[row.routing_type])}</Chip> : '—'}</td>
                  <td className={TD_DENSE}><Chip tone={STATUS_TONE[row.status]}>{VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status] ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status]) : row.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="u-title-card text-ink">{t('admin.agentProfile.matchesTitle')}</h2>
          <TableFrame minWidth="44rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.matching.colRequest')}</th>
                <th className={TH_STICKY}>{t('admin.matching.colCommune')}</th>
                <th className={TH_STICKY}>{t('admin.matching.colScore')}</th>
                <th className={TH_STICKY}>{t('admin.matching.colOutcome')}</th>
                <th className={TH_STICKY}>{t('admin.matching.colSent')}</th>
              </tr>
            </thead>
            <tbody>
              {matchRows.length === 0 ? <EmptyRow colSpan={5}>{t('admin.matching.matchesEmpty')}</EmptyRow> : matchRows.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}><Link href={`/admin/leads/${row.lead_id}`} className="font-semibold text-blue-deep hover:underline">#{row.lead_id}</Link></td>
                  <td className={TD_DENSE}>{row.commune || '—'}</td>
                  <td className={`${TD_DENSE} u-tabular`}>{row.score == null ? '—' : Math.round(row.score)}</td>
                  <td className={TD_DENSE}>
                    {row.status === 'FAILED' ? <Chip tone="danger">{t('admin.matching.statusFailed')}</Chip>
                      : row.proposed_property_id ? <Chip tone="success">{t('admin.matching.statusAnswered')}</Chip>
                        : <Chip tone="blue">{t('admin.matching.statusNotified')}</Chip>}
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </section>
      </div>
    );
  } else if (tab === 'performance') {
    const [summary, logs] = await Promise.all([
      getAgentPerformanceSummary(agent.id, 90).catch(() => null),
      listAgentPerformanceLogs(agent.id, 25).catch(() => []),
    ]);
    const responseRate = summary?.leads ? Math.round((summary.responded / summary.leads) * 100) : null;
    content = (
      <div className="flex flex-col gap-4">
        <p className="u-micro text-ink-45">{t('admin.agentProfile.performanceScope')}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <PanelStat label={t('admin.agentProfile.leads90')} value={summary?.leads ?? '—'} />
          <PanelStat label={t('admin.agentProfile.responseRate')} value={responseRate == null ? '—' : `${responseRate}%`} />
          <PanelStat label={t('admin.agentProfile.medianResponse')} value={formatLatency(summary?.median_latency_seconds)} />
          <PanelStat label={t('admin.agentProfile.viewings')} value={summary?.viewings ?? '—'} />
          <PanelStat label={t('admin.agentProfile.declined')} value={summary?.declined ?? '—'} />
        </div>
        <TableFrame minWidth="44rem">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.viewings.colListing')}</th>
              <th className={TH_STICKY}>{t('admin.agentProfile.colLead')}</th>
              <th className={TH_STICKY}>{t('admin.agentProfile.colFirstResponse')}</th>
              <th className={TH_STICKY}>{t('admin.agentProfile.colOutcome')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? <EmptyRow colSpan={4}>{t('admin.agentProfile.noLogs')}</EmptyRow> : logs.map((row) => (
              <tr key={`${row.viewing_request_id}-${row.lead_timestamp}`} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  {row.listing_id ? <Link href={`/admin/listings/${row.listing_id}`} className="font-semibold text-blue-deep hover:underline">#{row.listing_id}</Link> : '—'}
                  {row.title ? <div className="max-w-[16rem] truncate text-ink-45">{row.title}</div> : null}
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.lead_timestamp)}</td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{row.first_response_timestamp ? `${formatKinshasa(row.first_response_timestamp)} · ${formatLatency(row.response_latency_seconds)}` : '—'}</td>
                <td className={TD_DENSE}>{row.outcome_status ? <Chip tone={STATUS_TONE[row.outcome_status]}>{row.outcome_status}</Chip> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </div>
    );
  } else {
    const [notes, history] = await Promise.all([
      listNotes('agent', agent.id).catch(() => []),
      listEntityAudit('agent', agent.id, 100).catch(() => []),
    ]);
    content = <EntityTimeline entityType="agent" entityId={agent.id} notes={notes} history={history} canWrite={can(session?.role, 'notes.write')} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/agents" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.agents.backToAgents')}
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="u-title-page text-ink">{displayName}</h1>
          {agent.phone_verified_at ? <Chip tone="success">{t('admin.agents.verified')}</Chip> : <Chip tone="warning">{t('admin.agents.notVerified')}</Chip>}
          {agent.status === 0 ? <Chip tone="danger">{t('admin.agents.statusSuspended')}</Chip> : null}
        </div>

        <div className="u-micro mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-45">
          <span className="u-tabular">{agent.phone ? `+${agent.phone}` : '—'}</span>
          {agent.vendor_id ? (
            <Link href={`/admin/agencies/${agent.vendor_id}`} className="font-semibold text-blue-deep hover:underline">
              {agent.vendor_username || agent.agency_name}
            </Link>
          ) : (
            <span>{agent.agency_name || t('admin.agents.noAgency')}</span>
          )}
          <span>{t('admin.agentProfile.joined', { date: formatDate(agent.created_at) })}</span>
          <Link href={`/agents/${agent.id}`} target="_blank" className="inline-flex items-center gap-1 font-semibold text-blue-deep hover:underline">
            {t('admin.agentProfile.publicPage')}
            <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('admin.agentProfile.listingsQuota')}
          value={`${agent.listing_count}${agent.listing_limit != null ? ` / ${agent.listing_limit}` : ''}`}
          tone={agent.listing_limit != null && agent.listing_count >= agent.listing_limit ? 'text-danger' : undefined}
        />
        <Stat label={t('agent.listings.online')} value={agent.live_listing_count} />
        <Stat label={t('admin.agents.package')} value={agent.package_title || '—'} />
        <Stat
          label={t('admin.subscriptions.dueDate')}
          value={formatDate(agent.expire_date)}
          tone={agent.expire_date && new Date(agent.expire_date) < new Date() ? 'text-danger' : undefined}
        />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label={t('admin.agentProfile.tabs')}>
        {TABS.map((value) => (
          <Link
            key={value}
            href={value === 'overview' ? base : `${base}?tab=${value}`}
            scroll={false}
            aria-current={value === tab ? 'page' : undefined}
            className={`u-micro-strong -mb-px border-b-2 px-3 py-2 ${value === tab ? 'border-blue text-blue-deep' : 'border-transparent text-ink-45 hover:text-ink'}`}
          >
            {t(`admin.agentProfile.tab.${value}`)}
          </Link>
        ))}
      </nav>

      {content}
    </div>
  );
}
