import Link from 'next/link';
import { BILLING_VIEWS, getBillingSummary, listMembershipsForAdmin } from '@/lib/adminBilling';
import { getPackages } from '@/lib/subscriptions';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import ServerViewTools from '../table/ServerViewTools';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import MembershipActions from './MembershipActions';

export const dynamic = 'force-dynamic';

function day(value) {
  return value ? new Date(value).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
}

/**
 * The renewal desk and payment ledger. Opens on memberships expiring in the
 * next 30 days, soonest first — the list a finance person works through each
 * week. Revenue is RECORDED revenue (what admins entered; trials excluded):
 * there is no payment gateway, so nothing here claims a bank reconciliation.
 * Plan assignment, packages and featured listings stay on Subscriptions.
 */
export default async function AdminBillingPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const view = BILLING_VIEWS.includes(firstParam(raw.view)) ? firstParam(raw.view) : 'expiring';
  const filters = {
    view: view === 'expiring' ? undefined : view,
    q: firstParam(raw.q) || undefined,
    package: firstParam(raw.package) || undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };
  const session = await getAdminSession();

  const [listResult, summaryResult, packagesResult] = await Promise.allSettled([
    listMembershipsForAdmin({ view, q: filters.q, packageId: filters.package, limit, offset }),
    getBillingSummary(),
    getPackages(),
  ]);
  const list = listResult.status === 'fulfilled' ? listResult.value : null;
  const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
  const packages = packagesResult.status === 'fulfilled' ? packagesResult.value : [];
  const canManage = can(session?.role, 'billing.manage');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.billing.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.billing.subtitle')}</p>
        </div>
        <Link href="/admin/subscriptions" className="u-micro-strong text-blue-deep hover:underline">{t('admin.billing.toSubscriptions')}</Link>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('admin.billing.statExpiring')} value={summary.counts.expiring} />
          <Stat label={t('admin.billing.statActive')} value={summary.counts.active} />
          <Stat label={t('admin.billing.statExpired')} value={summary.counts.expired} />
          <Stat
            label={t('admin.billing.statRevenue')}
            value={summary.revenue.length ? summary.revenue.map((r) => `${Math.round(r.last30 || 0).toLocaleString('fr-FR')} ${r.currency}`).join(' · ') : '—'}
            hint={t('admin.billing.revenueHint')}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {BILLING_VIEWS.map((value) => (
          <Link
            key={value}
            href={buildHref('/admin/billing', params, { view: value === 'expiring' ? '' : value })}
            scroll={false}
            aria-current={value === view ? 'page' : undefined}
            className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${value === view ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
          >
            {t(`admin.billing.view.${value}`)}
            <span className="u-tabular text-ink-45">{summary?.counts?.[value] ?? ''}</span>
          </Link>
        ))}
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.billing.searchPlaceholder') }}
        resetKeys={['q', 'package']}
        filters={[{ type: 'select', param: 'package', label: t('admin.agents.package'), options: packages.map((pkg) => ({ value: String(pkg.id), label: pkg.title })) }]}
      >
        <ServerViewTools path="/admin/billing" params={params} exportDataset="memberships" />
      </TableToolbar>

      {listResult.status === 'rejected' ? <ErrorNote>{t('admin.billing.loadError', { error: listResult.reason?.message })}</ErrorNote> : null}

      <TableFrame
        minWidth="68rem"
        footer={list ? <Pagination pathname="/admin/billing" params={params} total={list.total} page={page} pageSize={pageSize} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.agencies.colAgency')}</th>
            <th className={TH_STICKY}>{t('admin.agents.package')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.billing.colAmount')}</th>
            <th className={TH_STICKY}>{t('admin.billing.colPayment')}</th>
            <th className={TH_STICKY}>{t('admin.billing.colPeriod')}</th>
            <th className={TH_STICKY}>{t('admin.billing.colStatus')}</th>
            {canManage ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {(list?.rows || []).length === 0 ? (
            <EmptyRow colSpan={canManage ? 7 : 6}>{t('admin.billing.empty')}</EmptyRow>
          ) : (
            list.rows.map((row) => {
              const active = row.status === 1;
              const daysLeft = row.days_left == null ? null : Number(row.days_left);
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    {row.vendor_id ? <Link href={`/admin/agencies/${row.vendor_id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{row.agency_name || `#${row.vendor_id}`}</Link> : '—'}
                  </td>
                  <td className={TD_DENSE}>
                    {row.package_title || '—'}
                    {row.is_trial ? <span className="ml-1.5"><Chip>{t('admin.agencies.trial')}</Chip></span> : null}
                  </td>
                  <td className={TD_DENSE_RIGHT}>{row.price != null ? `${Number(row.price).toLocaleString('fr-FR')} ${row.currency || row.currency_symbol || ''}` : '—'}</td>
                  <td className={TD_DENSE}>
                    {row.payment_method || '—'}
                    {row.transaction_id ? <div className="u-tabular text-ink-45">{row.transaction_id}</div> : null}
                    {!row.is_trial && Number(row.price) > 0 ? (
                      <Link href={`/admin/billing/${row.id}`} className="u-micro-strong text-blue-deep hover:underline">{t('admin.billing.receipt')}</Link>
                    ) : null}
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>
                    {day(row.start_date)} → {day(row.expire_date)}
                    {active && daysLeft != null && daysLeft >= 0 ? (
                      <div className={daysLeft <= 7 ? 'font-semibold text-danger' : 'text-ink-45'}>{t('admin.billing.daysLeft', { count: daysLeft })}</div>
                    ) : null}
                  </td>
                  <td className={TD_DENSE}>
                    {!active ? <Chip>{t('admin.billing.view.cancelled')}</Chip>
                      : daysLeft != null && daysLeft < 0 ? <Chip tone="danger">{t('admin.billing.view.expired')}</Chip>
                        : <Chip tone="success">{t('admin.billing.view.active')}</Chip>}
                  </td>
                  {canManage ? <td className={TD_DENSE}><MembershipActions membershipId={row.id} active={active} /></td> : null}
                </tr>
              );
            })
          )}
        </tbody>
      </TableFrame>
    </div>
  );
}
