import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Scale, Settings2 } from 'lucide-react';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { firstParam } from '@/lib/adminPagination';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { recentFortnights } from '@/lib/launchCommission';
import { SALES_PERIODS, formatMoneyList, periodRange, sumByCurrency } from '@/lib/salesRules';
import { getLastSalesSync, getSalesRepIdForAdmin, listSalesConsoleAccounts, listSalesPlans, listSalesReps } from '@/lib/sales';
import { getLaunchCounts } from '@/lib/salesLaunch';
import { referralLink } from '@/lib/salesReferral';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import PeriodChips from './PeriodChips';
import RepDialog from './RepDialog';
import RepRowActions from './RepRowActions';
import { BUTTON } from './styles';
import SyncCommissionsButton from './SyncCommissionsButton';

export const dynamic = 'force-dynamic';

const METRIC_LINK = 'rounded-sm hover:text-blue-deep hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue';

/**
 * The sales team at a glance: for each rep, how many agents they brought in
 * and how many listings those agents have on Lukka Place, how far along the
 * launch policy they are, what they earned and what is left to pay. Every
 * count opens the list behind it. A rep signed in with the `sales` role is
 * sent straight to their own page.
 */
export default async function AdminSalesPage({ searchParams }) {
  const t = await getT();
  const session = await getAdminSession();

  if (session?.role === 'sales') {
    const ownRepId = session.id ? await getSalesRepIdForAdmin(session.id).catch(() => null) : null;
    if (ownRepId) redirect(`/admin/sales/${ownRepId}`);
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-2 py-16 text-center">
        <h1 className="u-title-section text-ink">{t('admin.sales.notLinkedTitle')}</h1>
        <p className="u-micro text-ink-70">{t('admin.sales.notLinked')}</p>
      </div>
    );
  }

  const raw = (await searchParams) || {};
  const period = SALES_PERIODS.includes(firstParam(raw.period)) ? firstParam(raw.period) : 'month';
  const range = periodRange(period);
  const params = { period: period === 'month' ? undefined : period };
  const canManage = can(session?.role, 'sales.manage');

  const [repsResult, plansResult, accountsResult, syncResult, launchResult] = await Promise.allSettled([
    listSalesReps(range),
    listSalesPlans(),
    canManage ? listSalesConsoleAccounts() : Promise.resolve([]),
    getLastSalesSync(),
    getLaunchCounts(),
  ]);
  const reps = repsResult.status === 'fulfilled' ? repsResult.value : [];
  const plans = plansResult.status === 'fulfilled' ? plansResult.value : [];
  const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
  const lastSync = syncResult.status === 'fulfilled' ? syncResult.value : null;
  const launchByRep = new Map((launchResult.status === 'fulfilled' ? launchResult.value : []).map((row) => [row.rep_id, row]));

  const earned = sumByCurrency(reps.flatMap((rep) => rep.commissions), 'earned');
  const toApprove = sumByCurrency(reps.flatMap((rep) => rep.commissions), 'pending');
  const unpaid = sumByCurrency(reps.flatMap((rep) => rep.commissions), 'approved');
  const soldCount = reps.reduce((sum, rep) => sum + rep.soldCount, 0);
  const revenue = sumByCurrency(reps.flatMap((rep) => rep.sold), 'amount');
  const agentsTotal = reps.reduce((sum, rep) => sum + Number(rep.accounts || 0), 0);
  const listingsTotal = reps.reduce((sum, rep) => sum + Number(rep.live_listings || 0), 0);
  const qualifiedTotal = [...launchByRep.values()].reduce((sum, row) => sum + Number(row.qualified_agents || 0), 0);
  const currentFortnight = recentFortnights(new Date(), 1)[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.sales.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.sales.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Link href="/admin/sales/attribution" className={BUTTON}>
              <Scale strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.sales.attribution.link')}
            </Link>
          ) : null}
          <Link href="/admin/sales/plans" className={BUTTON}>
            <Settings2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.plans.link')}
          </Link>
          {canManage ? <SyncCommissionsButton /> : null}
          {canManage ? <RepDialog plans={plans} accounts={accounts} /> : null}
        </div>
      </div>

      <PeriodChips pathname="/admin/sales" params={params} period={period} />

      {repsResult.status === 'rejected' ? <ErrorNote>{t('admin.sales.loadError', { error: repsResult.reason?.message })}</ErrorNote> : null}
      {canManage && plans.length === 0 && repsResult.status === 'fulfilled' ? (
        <p className="u-micro rounded-card border border-warning/40 bg-warning-tint p-3 text-ink-70">
          {t('admin.sales.noPlansYet')} <Link href="/admin/sales/plans" className="font-semibold text-blue-deep hover:underline">{t('admin.sales.plans.link')}</Link>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label={t('admin.sales.team.agentsBrought')} value={agentsTotal} hint={t('admin.sales.team.qualifiedHint', { count: qualifiedTotal })} />
        <Stat label={t('admin.sales.team.theirListings')} value={listingsTotal} hint={t('admin.sales.team.theirListingsHint')} />
        <Stat label={t('admin.sales.statRevenue')} value={formatMoneyList(revenue)} hint={t('admin.sales.team.soldHint', { count: soldCount })} />
        <Stat label={t('admin.sales.statEarned')} value={formatMoneyList(earned, { field: 'amount' })} hint={t('admin.sales.statEarnedHint')} />
        <Stat label={t('admin.sales.statToApprove')} value={formatMoneyList(toApprove)} />
        <Stat label={t('admin.sales.statUnpaid')} value={formatMoneyList(unpaid)} hint={t('admin.sales.statReps', { count: reps.filter((rep) => rep.status === 'active').length })} />
      </div>

      <TableFrame minWidth="72rem">
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.sales.colRep')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.team.agentsBrought')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.team.theirListings')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.team.qualified')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.colSold')}</th>
            <th className={TH_STICKY}>{t('admin.sales.colEarned')}</th>
            <th className={TH_STICKY}>{t('admin.sales.colToPay')}</th>
            <th className={TH_STICKY}>{t('admin.sales.team.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {reps.length === 0 ? (
            <EmptyRow colSpan={8}>{t('admin.sales.empty')}</EmptyRow>
          ) : reps.map((rep) => {
            const launch = launchByRep.get(rep.id);
            const earnedByCurrency = (rep.commissions || []).map((c) => ({ currency: c.currency, amount: c.earned }));
            const toPay = (rep.commissions || []).map((c) => ({ currency: c.currency, amount: Number(c.pending) + Number(c.approved) }));
            const base = `/admin/sales/${rep.id}`;
            const perAgent = Number(rep.accounts) > 0 ? (Number(rep.live_listings) / Number(rep.accounts)).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : null;
            return (
              <tr key={rep.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link href={base} className="font-semibold text-ink hover:text-blue-deep hover:underline">{rep.full_name}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-ink-45">
                    {rep.status === 'active' ? null : <Chip>{t('admin.sales.reps.statusInactive')}</Chip>}
                    <span>{rep.plan_name || t('admin.sales.reps.noPlan')}</span>
                    {rep.referral_code ? <span className="u-ref">· {rep.referral_code}</span> : null}
                  </div>
                </td>
                <td className={TD_DENSE_RIGHT}>
                  <Link href={`${base}#referred`} className={`${METRIC_LINK} font-semibold text-ink`}>{rep.accounts}</Link>
                  {launch ? <div className="text-ink-45">{t('admin.sales.team.viaCode', { count: launch.registered })}</div> : null}
                </td>
                <td className={TD_DENSE_RIGHT}>
                  <Link href={`${base}?gfilter=with_listing#referred`} className={`${METRIC_LINK} font-semibold text-ink`}>{rep.live_listings}</Link>
                  <div className="text-ink-45">
                    {perAgent ? t('admin.sales.team.perAgent', { value: perAgent }) : null}
                    {launch?.credited_listings ? ` · ${t('admin.sales.team.credited', { count: launch.credited_listings })}` : ''}
                  </div>
                </td>
                <td className={TD_DENSE_RIGHT}>
                  {launch ? (
                    <>
                      <Link href={`${base}?gfilter=qualified#referred`} className={`${METRIC_LINK} font-semibold text-ink`}>{launch.qualified_agents}</Link>
                      <div className="text-ink-45">
                        <Link href={`${base}?gfilter=awaiting#referred`} className={METRIC_LINK}>
                          {t('admin.sales.team.awaiting', { count: launch.awaiting_validation })}
                        </Link>
                      </div>
                    </>
                  ) : '—'}
                </td>
                <td className={TD_DENSE_RIGHT}>
                  {rep.soldCount}
                  {rep.soldCount ? <div className="u-tabular text-ink-45">{formatMoneyList(rep.sold)}</div> : null}
                </td>
                <td className={`${TD_DENSE} u-tabular`}>{formatMoneyList(earnedByCurrency)}</td>
                <td className={`${TD_DENSE} u-tabular`}>
                  <Link href={`${base}?status=approved#ledger`} className={METRIC_LINK}>{formatMoneyList(toPay)}</Link>
                </td>
                <td className={TD_DENSE}>
                  <RepRowActions
                    repId={rep.id}
                    code={rep.referral_code}
                    link={rep.referral_code ? referralLink(rep.referral_code) : null}
                    payHref={`${base}?status=approved&fn=${currentFortnight}&payout=1#ledger`}
                    canManage={canManage}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableFrame>

      <p className="u-micro text-ink-45">
        {lastSync
          ? t('admin.sales.lastSync', { time: formatKinshasa(lastSync.created_at), actor: lastSync.actor_label })
          : t('admin.sales.neverSynced')}
        {' '}{t('admin.sales.howItWorks')}
      </p>
    </div>
  );
}
