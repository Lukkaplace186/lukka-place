import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import QRCode from 'qrcode';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { COMMISSION_STATUSES, SALES_PERIODS, formatMoneyList, periodRange } from '@/lib/salesRules';
import {
  LAUNCH_CURRENCY, QUALITY_AGE_DAYS, QUALITY_MIN_CHECKED, QUALITY_RATIO, acquisitionTier, fortnightRange, launchSummary,
  recentFortnights,
} from '@/lib/launchCommission';
import {
  getRepMonthlyTrend, getSalesRep, listActiveRepOptions, listApprovedLineRefs, listRepAccounts, listRepCommissions,
  listRepPayouts, listRepRenewalsDue, listSalesConsoleAccounts, listSalesPlans,
} from '@/lib/sales';
import { AUTO_VOID_REASON, REFERRED_AGENT_FILTERS, getLaunchCounts, listListingCredits, listReferredAgents } from '@/lib/salesLaunch';
import { referralLink, whatsappOnboardingLink, whatsappShareLink } from '@/lib/salesReferral';
import { getLocale, getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../../LeadRoutingUI';
import Pagination from '../../table/Pagination';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import PeriodChips from '../PeriodChips';
import RepDialog from '../RepDialog';
import CommissionLedger from './CommissionLedger';
import ListingCredits from './ListingCredits';
import ReferralToolkit from './ReferralToolkit';
import ReferredAgents from './ReferredAgents';
import RepAccounts from './RepAccounts';

export const dynamic = 'force-dynamic';

const STATUS_TONE = { pending: 'warning', approved: 'blue', paid: 'success', void: 'neutral' };
const DAY_MS = 24 * 60 * 60 * 1000;

function day(value) {
  return value ? new Date(value).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
}

function money(amount, currency) {
  return formatMoneyList([{ currency, amount }], { keepZero: true });
}

function usd(amount) {
  return money(amount, LAUNCH_CURRENCY);
}

function todayInKinshasa() {
  return new Date(new Date().getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function qrSvgFor(link) {
  try {
    return await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: 320 });
  } catch (err) {
    console.error(`[sales] QR code failed: ${err.message}`);
    return null;
  }
}

/**
 * One rep: their accounts, what those accounts did, the commissions it earned,
 * what was paid. A rep on the launch plan also gets their referral toolkit,
 * the acquisition funnel and tiers, the agents they brought in and the listings
 * credited to them. A `sales` user reaches only the rep linked to their own
 * console account, and sees no management control.
 */
export default async function AdminSalesRepPage({ params, searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const raw = (await searchParams) || {};
  const session = await getAdminSession();
  const period = SALES_PERIODS.includes(firstParam(raw.period)) ? firstParam(raw.period) : 'month';
  const rep = await getSalesRep(id, periodRange(period));
  if (!rep) notFound();
  const ownPageOnly = session?.role === 'sales';
  if (ownPageOnly && (rep.admin_user_id == null || Number(rep.admin_user_id) !== Number(session.id))) notFound();
  const canManage = can(session?.role, 'sales.manage');
  const isLaunch = rep.plan_kind === 'launch_milestones';

  const status = COMMISSION_STATUSES.includes(firstParam(raw.status)) ? firstParam(raw.status) : undefined;
  const fortnights = recentFortnights(new Date(), 6);
  const fortnight = fortnights.includes(firstParam(raw.fn)) ? firstParam(raw.fn) : undefined;
  const ledgerWindow = fortnight ? fortnightRange(fortnight) : null;
  const agentFilter = REFERRED_AGENT_FILTERS.includes(firstParam(raw.gfilter)) ? firstParam(raw.gfilter) : 'all';
  const accountsPage = parsePage(raw, { pageParam: 'apage', sizeParam: 'asize' });
  const ledgerPage = parsePage(raw, { pageParam: 'lpage', sizeParam: 'lsize' });
  const agentsPage = parsePage(raw, { pageParam: 'gpage', sizeParam: 'gsize' });
  const creditsPage = parsePage(raw, { pageParam: 'cpage', sizeParam: 'csize' });
  const base = `/admin/sales/${rep.id}`;
  const query = {
    period: period === 'month' ? undefined : period,
    status,
    fn: fortnight,
    gfilter: agentFilter === 'all' ? undefined : agentFilter,
    apage: accountsPage.page > 1 ? String(accountsPage.page) : undefined,
    lpage: ledgerPage.page > 1 ? String(ledgerPage.page) : undefined,
    gpage: agentsPage.page > 1 ? String(agentsPage.page) : undefined,
    cpage: creditsPage.page > 1 ? String(creditsPage.page) : undefined,
  };
  const loadLaunch = isLaunch || Boolean(rep.referral_code);

  const [
    accountsResult, ledgerResult, payoutsResult, renewalsResult, trendResult, plansResult, consoleAccountsResult,
    countsResult, agentsResult, creditsResult, repOptionsResult, scopeResult, qrResult,
  ] = await Promise.allSettled([
    listRepAccounts(rep.id, accountsPage),
    listRepCommissions(rep.id, { status, from: ledgerWindow?.from, to: ledgerWindow?.to, limit: ledgerPage.limit, offset: ledgerPage.offset }),
    listRepPayouts(rep.id),
    isLaunch ? Promise.resolve([]) : listRepRenewalsDue(rep.id),
    isLaunch ? Promise.resolve([]) : getRepMonthlyTrend(rep.id),
    canManage ? listSalesPlans() : Promise.resolve([]),
    canManage ? listSalesConsoleAccounts() : Promise.resolve([]),
    loadLaunch ? getLaunchCounts(rep.id) : Promise.resolve(null),
    loadLaunch ? listReferredAgents(rep.id, { filter: agentFilter, limit: agentsPage.limit, offset: agentsPage.offset }) : Promise.resolve({ total: 0, rows: [] }),
    loadLaunch ? listListingCredits(rep.id, { limit: creditsPage.limit, offset: creditsPage.offset }) : Promise.resolve({ total: 0, rows: [] }),
    canManage && loadLaunch ? listActiveRepOptions() : Promise.resolve([]),
    canManage && ledgerWindow ? listApprovedLineRefs(rep.id, ledgerWindow) : Promise.resolve(null),
    rep.referral_code ? qrSvgFor(referralLink(rep.referral_code, { qr: true })) : Promise.resolve(null),
  ]);
  const settled = (result, fallback) => (result.status === 'fulfilled' ? result.value : fallback);
  const accounts = settled(accountsResult, { total: 0, rows: [] });
  const ledger = settled(ledgerResult, { total: 0, rows: [], open: [] });
  const payouts = settled(payoutsResult, []);
  const renewals = settled(renewalsResult, []);
  const trend = settled(trendResult, []);
  const counts = settled(countsResult, null);
  const referred = settled(agentsResult, { total: 0, rows: [] });
  const credits = settled(creditsResult, { total: 0, rows: [] });
  const repOptions = settled(repOptionsResult, []);
  const scopeLines = settled(scopeResult, null);
  const qrSvg = settled(qrResult, null);
  const loadErrors = [accountsResult, ledgerResult, payoutsResult, renewalsResult, trendResult, countsResult, agentsResult, creditsResult]
    .filter((r) => r.status === 'rejected');

  const commissions = rep.commissions || [];
  const pick = (field) => commissions.map((c) => ({ currency: c.currency, amount: c[field] }));
  const soldThisMonth = trend[0]?.sold ?? 0;
  const target = Number(rep.monthly_target || 0);

  const summary = counts ? launchSummary({
    qualified: counts.payable_agents,
    totalConfirmed: counts.payable_listings,
    quality: { checked: counts.quality_checked, valid: counts.quality_valid },
    qualityEarned: counts.quality_earned,
    paid: counts.paid,
  }) : null;
  const projected = counts ? acquisitionTier(counts.qualified_agents) : null;
  // A subscription-plan rep has a code too (every rep gets one); their launch
  // sections appear only once the code has actually brought someone in.
  const showLaunch = Boolean(counts) && (isLaunch || counts.registered > 0);

  const sourceLabel = (row) => t(`admin.sales.source.${row.source_type}`);
  const ledgerDetail = (row) => {
    switch (row.source_type) {
      case 'subscription':
        return t('admin.sales.ledger.subscriptionDetail', { plan: row.package_title || '—', rate: row.rate, basis: money(row.basis_amount, row.currency) });
      case 'target':
        return t('admin.sales.ledger.targetDetail', { month: String(row.source_id).split(':')[1] || '', count: row.basis_amount });
      case 'milestone':
        return t('admin.sales.launch.ledger.milestoneDetail', { count: row.basis_amount });
      case 'listing_bonus':
        return t('admin.sales.launch.ledger.listingBonusDetail', { count: row.basis_amount });
      case 'quality':
        return t('admin.sales.launch.ledger.qualityDetail', { ratio: row.basis_amount });
      default:
        return row.note || null;
    }
  };
  const voidReasonLabel = (reason) => {
    if (reason === 'membership_cancelled') return t('admin.sales.ledger.voidCancelled');
    if (reason === AUTO_VOID_REASON) return t('admin.sales.launch.ledger.voidBelowThreshold');
    return reason;
  };
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
    detail: ledgerDetail(row),
    amount: row.amount,
    amountLabel: money(row.amount, row.currency),
    currency: row.currency,
    earnedLabel: formatKinshasa(row.earned_at),
    clawbackDue: row.clawback_due,
    voidReason: voidReasonLabel(row.void_reason),
    payoutId: row.payout_id,
  }));
  const openTotals = ledger.open.map((row) => ({
    status: row.status, currency: row.currency, count: row.n, label: money(row.amount, row.currency),
  }));

  const monthLabel = (key) => {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const fortnightLabel = (key) => t(key.endsWith('-1') ? 'admin.sales.launch.fortnight.first' : 'admin.sales.launch.fortnight.second', { month: monthLabel(key) });

  const nextTierHint = (tier, unitKey) => (tier.next
    ? t(unitKey, { count: tier.next.missing, amount: usd(tier.next.amount) })
    : t('admin.sales.launch.topTier'));

  const qualityValue = summary
    ? (summary.quality.amount > 0 && counts.quality_earned
      ? t('admin.sales.launch.quality.earned', { amount: usd(summary.quality.amount) })
      : summary.quality.eligible
        ? `${Math.round((summary.quality.ratio || 0) * 100)} %`
        : `${summary.quality.checked} / ${QUALITY_MIN_CHECKED}`)
    : '—';
  const qualityHint = summary
    ? (summary.quality.eligible
      ? t(summary.quality.passed ? 'admin.sales.launch.quality.passing' : 'admin.sales.launch.quality.failing', { ratio: Math.round(QUALITY_RATIO * 100), valid: summary.quality.valid, checked: summary.quality.checked })
      : t('admin.sales.launch.quality.maturing', { count: counts.quality_maturing, min: QUALITY_MIN_CHECKED, days: QUALITY_AGE_DAYS }))
    : null;

  const referredRows = referred.rows.map((row) => ({
    agentId: row.agent_id,
    name: row.name,
    phone: row.phone ? `+${row.phone}` : null,
    verified: Boolean(row.phone_verified_at),
    profileOk: Boolean(row.profile_ok),
    sourceLabel: t(`admin.sales.launch.source.${row.source}`),
    code: row.referral_code,
    credited: Number(row.credited || 0),
    listingsTotal: Number(row.listings_total || 0),
    listingsBefore: Number(row.listings_before || 0),
    qualified: Boolean(row.qualified),
    qualifiedAt: row.qualified_at ? t('admin.sales.launch.agents.qualifiedOn', { date: day(row.qualified_at) }) : null,
    validation: row.validation_status,
    rejectionReason: row.rejection_reason,
    registeredAt: day(row.registered_at || row.attributed_at),
    repName: rep.full_name,
  }));
  const creditRows = credits.rows.map((row) => ({
    id: row.id,
    propertyId: row.property_id,
    title: row.title,
    agentName: row.agent_name,
    confirmedAt: day(row.confirmed_at),
    stateNow: row.state_now,
    day30State: row.day30_state,
    day30Valid: row.day30_valid,
    day30Due: day(new Date(new Date(row.confirmed_at).getTime() + QUALITY_AGE_DAYS * DAY_MS)),
    excludedReason: row.excluded_reason,
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
              isLaunch
                ? t('admin.sales.launch.planLine', { plan: rep.plan_name })
                : rep.plan_name ? t('admin.sales.reps.planLine', {
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
            rep={{
              id: rep.id, full_name: rep.full_name, phone: rep.phone, email: rep.email, plan_id: rep.plan_id ? Number(rep.plan_id) : null,
              status: rep.status, admin_user_id: rep.admin_user_id ? Number(rep.admin_user_id) : null, referral_code: rep.referral_code,
            }}
            plans={settled(plansResult, [])}
            accounts={settled(consoleAccountsResult, [])}
          />
        ) : null}
      </div>

      {loadErrors.length ? <ErrorNote>{t('admin.sales.loadError', { error: loadErrors[0].reason?.message })}</ErrorNote> : null}

      {rep.referral_code ? (
        <ReferralToolkit
          code={rep.referral_code}
          link={referralLink(rep.referral_code)}
          qrSvg={qrSvg}
          shareHref={whatsappShareLink(rep.referral_code)}
          onboardingHref={whatsappOnboardingLink(rep.referral_code)}
        />
      ) : null}

      {showLaunch ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="u-title-section text-ink">{t('admin.sales.launch.title')}</h2>
            <p className="u-micro mt-1 text-ink-45">{t('admin.sales.launch.subtitle')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('admin.sales.launch.funnel.clicks')} value={counts.clicks} />
            <Stat label={t('admin.sales.launch.funnel.registered')} value={counts.registered} />
            <Stat label={t('admin.sales.launch.funnel.withListing')} value={counts.with_listing} />
            <Stat
              label={t('admin.sales.launch.funnel.qualified')}
              value={counts.qualified_agents}
              hint={t('admin.sales.launch.funnel.qualifiedHint', { validated: counts.payable_agents, awaiting: counts.awaiting_validation })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label={t('admin.sales.launch.acquisition')}
              value={usd(summary.acquisition.amount)}
              hint={nextTierHint(summary.acquisition, 'admin.sales.launch.nextAgents')}
            />
            <Stat
              label={t('admin.sales.launch.additional')}
              value={`${summary.additional.count} · ${usd(summary.additional.amount)}`}
              hint={nextTierHint(summary.additional, 'admin.sales.launch.nextListings')}
            />
            <Stat label={t('admin.sales.launch.quality.title')} value={qualityValue} hint={qualityHint} />
            <Stat
              label={t('admin.sales.launch.outstanding')}
              value={usd(Number(counts.pending) + Number(counts.approved))}
              hint={t('admin.sales.launch.outstandingHint', { earned: usd(Number(counts.pending) + Number(counts.approved) + Number(counts.paid)), paid: usd(counts.paid) })}
            />
          </div>
          {counts.awaiting_validation > 0 && projected.amount > summary.acquisition.amount ? (
            <p className="u-micro rounded-card border border-warning/40 bg-warning-tint p-3 text-ink-70">
              {t('admin.sales.launch.awaitingNote', { count: counts.awaiting_validation, amount: usd(projected.amount) })}
            </p>
          ) : null}
          {counts.clawbacks > 0 ? (
            <p className="u-micro rounded-card border border-danger/40 bg-danger-tint p-3 text-ink-70">{t('admin.sales.launch.clawbackNote', { count: counts.clawbacks })}</p>
          ) : null}
          <p className="u-micro text-ink-45">{t('admin.sales.launch.rules')}</p>
        </section>
      ) : null}

      {isLaunch ? null : (
        <>
          <PeriodChips pathname={base} params={{ status }} period={period} />
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
        </>
      )}

      {showLaunch ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="u-title-card text-ink">{t('admin.sales.launch.agents.title')}</h2>
            <div className="flex flex-wrap gap-2">
              {REFERRED_AGENT_FILTERS.map((value) => (
                <Link
                  key={value}
                  href={buildHref(base, query, { gfilter: value === 'all' ? '' : value, gpage: '' })}
                  scroll={false}
                  aria-current={value === agentFilter ? 'page' : undefined}
                  className={`u-micro-strong rounded-full border px-3 py-1 ${value === agentFilter ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
                >
                  {t(`admin.sales.launch.agents.filter.${value}`)}
                </Link>
              ))}
            </div>
          </div>
          <ReferredAgents
            repId={rep.id}
            rows={referredRows}
            canManage={canManage}
            reps={repOptions}
            today={todayInKinshasa()}
            footer={<Pagination pathname={base} params={query} total={referred.total} page={agentsPage.page} pageSize={agentsPage.pageSize} pageParam="gpage" sizeParam="gsize" />}
          />
        </section>
      ) : null}

      {showLaunch ? (
        <section className="flex flex-col gap-2">
          <h2 className="u-title-card text-ink">{t('admin.sales.launch.credits.title')}</h2>
          <ListingCredits
            repId={rep.id}
            rows={creditRows}
            canManage={canManage}
            footer={<Pagination pathname={base} params={query} total={credits.total} page={creditsPage.page} pageSize={creditsPage.pageSize} pageParam="cpage" sizeParam="csize" />}
          />
        </section>
      ) : null}

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
        <div className="flex flex-wrap items-center gap-2">
          <span className="u-micro text-ink-45">{t('admin.sales.launch.fortnight.label')}</span>
          {[undefined, ...fortnights].map((value) => (
            <Link
              key={value || 'all'}
              href={buildHref(base, query, { fn: value || '', lpage: '' })}
              scroll={false}
              aria-current={value === fortnight ? 'page' : undefined}
              className={`u-micro-strong rounded-full border px-3 py-1 ${value === fortnight ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
            >
              {value ? fortnightLabel(value) : t('admin.sales.launch.fortnight.all')}
            </Link>
          ))}
        </div>
        <CommissionLedger
          repId={rep.id}
          rows={ledgerRows}
          openTotals={openTotals}
          canManage={canManage}
          today={todayInKinshasa()}
          defaultCurrency={rep.plan_currency || 'USD'}
          scopeLines={scopeLines}
          scopeLabel={fortnight ? fortnightLabel(fortnight) : null}
          footer={<Pagination pathname={base} params={query} total={ledger.total} page={ledgerPage.page} pageSize={ledgerPage.pageSize} pageParam="lpage" sizeParam="lsize" />}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.sales.accounts.title')}</h2>
        <RepAccounts
          repId={rep.id}
          canManage={canManage && rep.status === 'active' && !isLaunch}
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

      {isLaunch ? null : (
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
      )}

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
