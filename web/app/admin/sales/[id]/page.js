import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { COMMISSION_STATUSES, SALES_PERIODS, formatMoneyList, periodRange } from '@/lib/salesRules';
import {
  getRepMonthlyTrend, getSalesRep, listRepAccounts, listRepCommissions, listRepPayouts, listRepRenewalsDue,
  listSalesConsoleAccounts, listSalesPlans,
} from '@/lib/sales';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../../LeadRoutingUI';
import Pagination from '../../table/Pagination';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import PeriodChips from '../PeriodChips';
import RepDialog from '../RepDialog';
import CommissionLedger from './CommissionLedger';
import RepAccounts from './RepAccounts';

export const dynamic = 'force-dynamic';

const STATUS_TONE = { pending: 'warning', approved: 'blue', paid: 'success', void: 'neutral' };

function day(value) {
  return value ? new Date(value).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
}

function money(amount, currency) {
  return formatMoneyList([{ currency, amount }], { keepZero: true });
}

function todayInKinshasa() {
  return new Date(new Date().getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * One rep: their accounts, what those accounts did, the commissions it earned,
 * what was paid, and which plans are about to lapse. A `sales` user reaches
 * only the rep linked to their own console account.
 */
export default async function AdminSalesRepPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const raw = (await searchParams) || {};
  const session = await getAdminSession();
  const period = SALES_PERIODS.includes(firstParam(raw.period)) ? firstParam(raw.period) : 'month';
  const rep = await getSalesRep(id, periodRange(period));
  if (!rep) notFound();
  const ownPageOnly = session?.role === 'sales';
  if (ownPageOnly && (rep.admin_user_id == null || Number(rep.admin_user_id) !== Number(session.id))) notFound();
  const canManage = can(session?.role, 'sales.manage');

  const status = COMMISSION_STATUSES.includes(firstParam(raw.status)) ? firstParam(raw.status) : undefined;
  const accountsPage = parsePage(raw, { pageParam: 'apage', sizeParam: 'asize' });
  const ledgerPage = parsePage(raw, { pageParam: 'lpage', sizeParam: 'lsize' });
  const base = `/admin/sales/${rep.id}`;
  const query = {
    period: period === 'month' ? undefined : period,
    status,
    apage: accountsPage.page > 1 ? String(accountsPage.page) : undefined,
    lpage: ledgerPage.page > 1 ? String(ledgerPage.page) : undefined,
  };

  const [accountsResult, ledgerResult, payoutsResult, renewalsResult, trendResult, plansResult, consoleAccountsResult] = await Promise.allSettled([
    listRepAccounts(rep.id, accountsPage),
    listRepCommissions(rep.id, { status, limit: ledgerPage.limit, offset: ledgerPage.offset }),
    listRepPayouts(rep.id),
    listRepRenewalsDue(rep.id),
    getRepMonthlyTrend(rep.id),
    canManage ? listSalesPlans() : Promise.resolve([]),
    canManage ? listSalesConsoleAccounts() : Promise.resolve([]),
  ]);
  const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : { total: 0, rows: [] };
  const ledger = ledgerResult.status === 'fulfilled' ? ledgerResult.value : { total: 0, rows: [], open: [] };
  const payouts = payoutsResult.status === 'fulfilled' ? payoutsResult.value : [];
  const renewals = renewalsResult.status === 'fulfilled' ? renewalsResult.value : [];
  const trend = trendResult.status === 'fulfilled' ? trendResult.value : [];
  const loadErrors = [accountsResult, ledgerResult, payoutsResult, renewalsResult, trendResult].filter((r) => r.status === 'rejected');

  const commissions = rep.commissions || [];
  const pick = (field) => commissions.map((c) => ({ currency: c.currency, amount: c[field] }));
  const soldThisMonth = trend[0]?.sold ?? 0;
  const target = Number(rep.monthly_target || 0);

  const sourceLabel = (row) => t(`admin.sales.source.${row.source_type}`);
  const ledgerRows = ledger.rows.map((row) => ({
    id: row.id,
    status: row.status,
    statusLabel: t(`admin.sales.status.${row.status}`),
    statusTone: STATUS_TONE[row.status] || 'neutral',
    source: sourceLabel(row),
    account: row.account_label || null,
    accountHref: row.source_type === 'subscription' && row.vendor_id
      ? `/admin/agencies/${row.vendor_id}`
      : row.agent_id ? `/admin/agents/${row.agent_id}` : null,
    detail: row.source_type === 'subscription'
      ? t('admin.sales.ledger.subscriptionDetail', {
        plan: row.package_title || '—', rate: row.rate, basis: money(row.basis_amount, row.currency),
      })
      : row.source_type === 'target'
        ? t('admin.sales.ledger.targetDetail', { month: String(row.source_id).split(':')[1] || '', count: row.basis_amount })
        : row.note || null,
    amount: row.amount,
    amountLabel: money(row.amount, row.currency),
    currency: row.currency,
    earnedLabel: formatKinshasa(row.earned_at),
    clawbackDue: row.clawback_due,
    voidReason: row.void_reason === 'membership_cancelled' ? t('admin.sales.ledger.voidCancelled') : row.void_reason,
    payoutId: row.payout_id,
  }));
  const openTotals = ledger.open.map((row) => ({
    status: row.status, currency: row.currency, count: row.n, label: money(row.amount, row.currency),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {ownPageOnly ? null : (
            <Link href="/admin/sales" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
              <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.sales.back')}
            </Link>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="u-title-page text-ink">{rep.full_name}</h1>
            {rep.status === 'active' ? <Chip tone="success">{t('admin.sales.reps.statusActive')}</Chip> : <Chip>{t('admin.sales.reps.statusInactive')}</Chip>}
          </div>
          <p className="u-micro mt-1 text-ink-45">
            {[
              rep.plan_name ? t('admin.sales.reps.planLine', {
                plan: rep.plan_name,
                rate: rep.subscription_rate ?? 0,
                bonus: money(rep.onboarding_bonus ?? 0, rep.plan_currency || 'USD'),
              }) : t('admin.sales.reps.noPlan'),
              rep.phone ? `+${rep.phone}` : null,
              rep.email,
              rep.account_name ? t('admin.sales.reps.signsInAs', { name: rep.account_name }) : null,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {canManage ? (
          <RepDialog
            rep={{ id: rep.id, full_name: rep.full_name, phone: rep.phone, email: rep.email, plan_id: rep.plan_id ? Number(rep.plan_id) : null, status: rep.status, admin_user_id: rep.admin_user_id ? Number(rep.admin_user_id) : null }}
            plans={plansResult.status === 'fulfilled' ? plansResult.value : []}
            accounts={consoleAccountsResult.status === 'fulfilled' ? consoleAccountsResult.value : []}
          />
        ) : null}
      </div>

      <PeriodChips pathname={base} params={{ status }} period={period} />

      {loadErrors.length ? <ErrorNote>{t('admin.sales.loadError', { error: loadErrors[0].reason?.message })}</ErrorNote> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.sales.colAccounts')} value={rep.accounts} hint={t('admin.sales.liveListingsHint', { count: rep.live_listings })} />
        <Stat label={t('admin.sales.colOnboarded')} value={rep.onboarded} hint={t(`admin.sales.period.${period}`)} />
        <Stat label={t('admin.sales.colSold')} value={rep.soldCount} hint={formatMoneyList(rep.sold)} />
        <Stat label={t('admin.sales.colEarned')} value={formatMoneyList(pick('earned'))} hint={t(`admin.sales.period.${period}`)} />
        <Stat label={t('admin.sales.statToApprove')} value={formatMoneyList(pick('pending'))} />
        <Stat label={t('admin.sales.statUnpaid')} value={formatMoneyList(pick('approved'))} />
        <Stat label={t('admin.sales.statPaid')} value={formatMoneyList(pick('paid'))} hint={t('admin.sales.allTime')} />
        <Stat
          label={t('admin.sales.targetTitle')}
          value={target > 0 ? `${soldThisMonth} / ${target}` : '—'}
          hint={target > 0
            ? (soldThisMonth >= target ? t('admin.sales.targetReached', { bonus: money(rep.target_bonus, rep.plan_currency) }) : t('admin.sales.targetRemaining', { count: target - soldThisMonth, bonus: money(rep.target_bonus, rep.plan_currency) }))
            : t('admin.sales.noTarget')}
        />
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="u-title-card text-ink">{t('admin.sales.ledger.title')}</h2>
          <div className="flex flex-wrap gap-2">
            {[undefined, ...COMMISSION_STATUSES].map((value) => (
              <Link
                key={value || 'all'}
                href={buildHref(base, query, { status: value || '', lpage: '' })}
                scroll={false}
                aria-current={value === status ? 'page' : undefined}
                className={`u-micro-strong rounded-full border px-3 py-1 ${value === status ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
              >
                {value ? t(`admin.sales.status.${value}`) : t('admin.table.all')}
              </Link>
            ))}
          </div>
        </div>
        <CommissionLedger
          repId={rep.id}
          rows={ledgerRows}
          openTotals={openTotals}
          canManage={canManage}
          today={todayInKinshasa()}
          defaultCurrency={rep.plan_currency || 'USD'}
          footer={<Pagination pathname={base} params={query} total={ledger.total} page={ledgerPage.page} pageSize={ledgerPage.pageSize} pageParam="lpage" sizeParam="lsize" />}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.sales.accounts.title')}</h2>
        <RepAccounts
          repId={rep.id}
          canManage={canManage && rep.status === 'active'}
          today={todayInKinshasa()}
          rows={accounts.rows.map((row) => ({
            agentId: row.agent_id,
            name: row.name,
            phone: row.phone ? `+${row.phone}` : null,
            verified: Boolean(row.phone_verified_at),
            active: row.status === 1,
            liveListings: row.live_listings,
            plan: row.package_title ? t('admin.sales.accounts.planUntil', { plan: row.package_title, date: day(row.expire_date) }) : null,
            creditFrom: formatKinshasa(row.credit_from),
          }))}
          footer={<Pagination pathname={base} params={query} total={accounts.total} page={accountsPage.page} pageSize={accountsPage.pageSize} pageParam="apage" sizeParam="asize" />}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="u-title-card text-ink">{t('admin.sales.renewals.title')}</h2>
          <TableFrame minWidth="32rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.agencies.colAgency')}</th>
                <th className={TH_STICKY}>{t('admin.agents.package')}</th>
                <th className={TH_STICKY_RIGHT}>{t('admin.sales.renewals.expires')}</th>
              </tr>
            </thead>
            <tbody>
              {renewals.length === 0 ? <EmptyRow colSpan={3}>{t('admin.sales.renewals.empty')}</EmptyRow> : renewals.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}><Link href={`/admin/agencies/${row.vendor_id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{row.agency_name}</Link></td>
                  <td className={TD_DENSE}>{row.package_title || '—'}</td>
                  <td className={TD_DENSE_RIGHT}>
                    {day(row.expire_date)}
                    <div className={Number(row.days_left) <= 7 ? 'font-semibold text-danger' : 'text-ink-45'}>{t('admin.billing.daysLeft', { count: Number(row.days_left) })}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="u-title-card text-ink">{t('admin.sales.trend.title')}</h2>
          <TableFrame minWidth="32rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.sales.trend.month')}</th>
                <th className={TH_STICKY_RIGHT}>{t('admin.sales.colSold')}</th>
                <th className={TH_STICKY_RIGHT}>{t('admin.sales.colOnboarded')}</th>
                <th className={TH_STICKY}>{t('admin.sales.colEarned')}</th>
              </tr>
            </thead>
            <tbody>
              {trend.length === 0 ? <EmptyRow colSpan={4}>{t('admin.sales.trend.empty')}</EmptyRow> : trend.map((row) => (
                <tr key={row.month} className={TR_DENSE}>
                  <td className={`${TD_DENSE} u-tabular`}>{row.month}</td>
                  <td className={TD_DENSE_RIGHT}>{row.sold}{target > 0 && row.sold >= target ? ' ✓' : ''}</td>
                  <td className={TD_DENSE_RIGHT}>{row.onboarded}</td>
                  <td className={`${TD_DENSE} u-tabular`}>{formatMoneyList(row.earned)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.sales.payouts.title')}</h2>
        <TableFrame minWidth="48rem">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.sales.payouts.paidAt')}</th>
              <th className={TH_STICKY_RIGHT}>{t('admin.sales.payouts.total')}</th>
              <th className={TH_STICKY}>{t('admin.sales.payouts.method')}</th>
              <th className={TH_STICKY_RIGHT}>{t('admin.sales.payouts.lines')}</th>
              <th className={TH_STICKY}>{t('admin.sales.payouts.recordedBy')}</th>
            </tr>
          </thead>
          <tbody>
            {payouts.length === 0 ? <EmptyRow colSpan={5}>{t('admin.sales.payouts.empty')}</EmptyRow> : payouts.map((row) => (
              <tr key={row.id} className={TR_DENSE}>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{day(row.paid_at)}</td>
                <td className={`${TD_DENSE_RIGHT} font-semibold text-ink`}>{money(row.total, row.currency)}</td>
                <td className={TD_DENSE}>
                  {row.method}
                  {row.reference ? <div className="u-tabular text-ink-45">{row.reference}</div> : null}
                  {row.note ? <div className="text-ink-45">{row.note}</div> : null}
                </td>
                <td className={TD_DENSE_RIGHT}>{row.lines}</td>
                <td className={TD_DENSE}>{row.recorded_by_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </section>
    </div>
  );
}
