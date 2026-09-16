import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Settings2 } from 'lucide-react';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { firstParam } from '@/lib/adminPagination';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { SALES_PERIODS, formatMoneyList, periodRange, sumByCurrency } from '@/lib/salesRules';
import { getLastSalesSync, getSalesRepIdForAdmin, listSalesConsoleAccounts, listSalesPlans, listSalesReps } from '@/lib/sales';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import PeriodChips from './PeriodChips';
import RepDialog from './RepDialog';
import { BUTTON } from './styles';
import SyncCommissionsButton from './SyncCommissionsButton';

export const dynamic = 'force-dynamic';

/**
 * The sales team: who brought in which agents and subscriptions, what that
 * earned them, and what is still to approve and pay. A rep signed in with the
 * `sales` role is sent straight to their own page.
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

  const [repsResult, plansResult, accountsResult, syncResult] = await Promise.allSettled([
    listSalesReps(range),
    listSalesPlans(),
    canManage ? listSalesConsoleAccounts() : Promise.resolve([]),
    getLastSalesSync(),
  ]);
  const reps = repsResult.status === 'fulfilled' ? repsResult.value : [];
  const plans = plansResult.status === 'fulfilled' ? plansResult.value : [];
  const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
  const lastSync = syncResult.status === 'fulfilled' ? syncResult.value : null;

  const revenue = sumByCurrency(reps.flatMap((rep) => rep.sold), 'amount');
  const earned = sumByCurrency(reps.flatMap((rep) => rep.commissions), 'earned');
  const toApprove = sumByCurrency(reps.flatMap((rep) => rep.commissions), 'pending');
  const unpaid = sumByCurrency(reps.flatMap((rep) => rep.commissions), 'approved');
  const soldCount = reps.reduce((sum, rep) => sum + rep.soldCount, 0);
  const onboarded = reps.reduce((sum, rep) => sum + Number(rep.onboarded || 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.sales.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.sales.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.sales.statRevenue')} value={formatMoneyList(revenue)} hint={t('admin.sales.statSold', { count: soldCount, onboarded })} />
        <Stat label={t('admin.sales.statEarned')} value={formatMoneyList(earned, { field: 'amount' })} hint={t('admin.sales.statEarnedHint')} />
        <Stat label={t('admin.sales.statToApprove')} value={formatMoneyList(toApprove)} />
        <Stat label={t('admin.sales.statUnpaid')} value={formatMoneyList(unpaid)} hint={t('admin.sales.statReps', { count: reps.filter((rep) => rep.status === 'active').length })} />
      </div>

      <TableFrame minWidth="72rem">
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.sales.colRep')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.colAccounts')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.colOnboarded')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.colSold')}</th>
            <th className={TH_STICKY}>{t('admin.sales.colRevenue')}</th>
            <th className={TH_STICKY}>{t('admin.sales.colEarned')}</th>
            <th className={TH_STICKY}>{t('admin.sales.colToPay')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.colLive')}</th>
          </tr>
        </thead>
        <tbody>
          {reps.length === 0 ? (
            <EmptyRow colSpan={8}>{t('admin.sales.empty')}</EmptyRow>
          ) : reps.map((rep) => {
            const earnedByCurrency = (rep.commissions || []).map((c) => ({ currency: c.currency, amount: c.earned }));
            const toPay = (rep.commissions || []).map((c) => ({ currency: c.currency, amount: Number(c.pending) + Number(c.approved) }));
            return (
              <tr key={rep.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link href={`/admin/sales/${rep.id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{rep.full_name}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-ink-45">
                    {rep.status === 'active' ? null : <Chip>{t('admin.sales.reps.statusInactive')}</Chip>}
                    <span>{rep.plan_name || t('admin.sales.reps.noPlan')}</span>
                    {rep.account_name ? <span>· {t('admin.sales.reps.signsInAs', { name: rep.account_name })}</span> : null}
                  </div>
                </td>
                <td className={TD_DENSE_RIGHT}>{rep.accounts}</td>
                <td className={TD_DENSE_RIGHT}>{rep.onboarded}</td>
                <td className={TD_DENSE_RIGHT}>{rep.soldCount}</td>
                <td className={`${TD_DENSE} u-tabular`}>{formatMoneyList(rep.sold)}</td>
                <td className={`${TD_DENSE} u-tabular`}>{formatMoneyList(earnedByCurrency)}</td>
                <td className={`${TD_DENSE} u-tabular`}>{formatMoneyList(toPay)}</td>
                <td className={TD_DENSE_RIGHT}>{rep.live_listings}</td>
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
