import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAgencyAgentIds, getAgencyForAdmin } from '@/lib/adminAgencies';
import { getVendors, listAgentsForAdmin } from '@/lib/agents';
import { getAgentBillingHistory } from '@/lib/subscriptions';
import { listEntityAudit } from '@/lib/adminAudit';
import { listNotes } from '@/lib/adminNotes';
import { parsePage } from '@/lib/adminPagination';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { Stat, formatKinshasa } from '../../LeadRoutingUI';
import EntityTimeline from '../../EntityTimeline';
import Pagination from '../../table/Pagination';
import AgentsTable from '../../agents/AgentsTable';
import { toAgentTableRows } from '../../agents/agentRows';
import AgencyBulkActions from './AgencyBulkActions';

export const dynamic = 'force-dynamic';

/** One agency: its roster (with bulk actions), portfolio, plan history and notes. */
export default async function AdminAgencyDetailPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const raw = (await searchParams) || {};
  const agency = await getAgencyForAdmin(id);
  if (!agency) notFound();
  const session = await getAdminSession();
  const { page, pageSize, limit, offset } = parsePage(raw);
  const base = `/admin/agencies/${agency.id}`;

  const [agentsResult, vendorsResult, billingResult, idsResult, notesResult, historyResult] = await Promise.allSettled([
    listAgentsForAdmin({ vendorId: agency.id, sort: 'listings', limit, offset }),
    getVendors(),
    getAgentBillingHistory(agency.id),
    getAgencyAgentIds(agency.id),
    listNotes('agency', agency.id),
    listEntityAudit('agency', agency.id, 50),
  ]);
  const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : { total: 0, rows: [] };
  const billing = billingResult.status === 'fulfilled' ? billingResult.value : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/agencies" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.agencies.back')}
        </Link>
        <h1 className="u-title-page mt-2 text-ink">{agency.username}</h1>
        <p className="u-micro mt-1 text-ink-45">
          {[agency.email, agency.phone ? `+${agency.phone}` : null, `#${agency.id}`].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.agencies.colAgents')} value={agency.agents} hint={t('admin.agencies.verifiedShort', { count: agency.verified_agents })} />
        <Stat label={t('admin.agencies.colLive')} value={agency.live_listings} />
        <Stat label={t('admin.agencies.colPending')} value={agency.pending_listings} />
        <Stat label={t('admin.agents.package')} value={agency.package_title || '—'} hint={agency.expire_date ? t('admin.agents.until', { date: new Date(agency.expire_date).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) }) : null} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="u-title-card text-ink">{t('admin.agencies.rosterTitle')}</h2>
              {can(session?.role, 'agents.bulk') && idsResult.status === 'fulfilled' ? (
                <AgencyBulkActions agentIds={idsResult.value} agencyName={agency.username} />
              ) : null}
            </div>
            <AgentsTable
              rows={toAgentTableRows(agents.rows)}
              vendors={(vendorsResult.status === 'fulfilled' ? vendorsResult.value : []).map((vendor) => ({ id: vendor.id, username: vendor.username }))}
              footer={<Pagination pathname={base} params={{ page: page > 1 ? String(page) : undefined }} total={agents.total} page={page} pageSize={pageSize} />}
            />
          </section>

          <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
            <h2 className="u-title-card text-ink">{t('admin.agentPanel.subscriptionHistory')}</h2>
            {billing.length === 0 ? <p className="u-micro text-ink-45">{t('admin.agentProfile.noBilling')}</p> : (
              <ul className="flex flex-col divide-y divide-line">
                {billing.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div>
                      <div className="u-micro-strong text-ink">{row.package_title || '—'}</div>
                      <div className="u-micro text-ink-45">{formatKinshasa(row.start_date)} → {formatKinshasa(row.expire_date)}{row.payment_method ? ` · ${row.payment_method}` : ''}</div>
                    </div>
                    <div className="u-micro u-tabular text-ink-70">{row.price != null ? `${Number(row.price).toLocaleString('fr-FR')} ${row.currency_symbol || '$'}` : '—'}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <EntityTimeline
          entityType="agency"
          entityId={agency.id}
          notes={notesResult.status === 'fulfilled' ? notesResult.value : []}
          history={historyResult.status === 'fulfilled' ? historyResult.value : []}
          canWrite={can(session?.role, 'notes.write')}
        />
      </div>
    </div>
  );
}
