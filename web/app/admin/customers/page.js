import Link from 'next/link';
import { getLeadCountsByWaIds } from '@/lib/adminApi';
import ServerViewTools from '../table/ServerViewTools';
import { ADMIN_CUSTOMER_STATUSES, adminListCustomersPage } from '@/lib/customers';
import { firstParam, parseCursor, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import { adminSetCustomerPasswordAction, adminUnlockCustomerAction } from './actions';
import CustomerRowActions from './CustomerRowActions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL_KEYS = {
  active: 'admin.customers.statusActive',
  locked: 'admin.customers.statusLocked',
  unverified: 'admin.customers.statusUnverified',
};

function formatDay(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kinshasa' }).format(date);
}

/**
 * Customer accounts, one server page at a time.
 *
 * Search is debounced in the toolbar and matched in Postgres (name, or the
 * stored E.164 digits). Enquiry and viewing counts come from the engine's
 * SQLite, one request for the whole page keyed by phone; if the engine is
 * down those two columns say so instead of showing zeros.
 *
 * Password reset stays the one account WRITE this console performs on a
 * customer (web/CLAUDE.md), plus lifting a lockout — which the reset already
 * did as a side effect, and which previously required choosing a new password
 * just to let someone retry the one they have.
 */
export default async function AdminCustomersPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const filters = {
    q: firstParam(raw.q) || undefined,
    status: ADMIN_CUSTOMER_STATUSES.includes(firstParam(raw.status)) ? firstParam(raw.status) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  let result = null;
  let loadError = null;
  try {
    result = await adminListCustomersPage({ ...filters, limit, offset, cursor: parseCursor(raw) });
  } catch (err) {
    loadError = err.message;
  }
  const rows = result?.rows || [];

  let counts = null;
  let countsError = null;
  try {
    counts = await getLeadCountsByWaIds(rows.map((row) => row.phone));
  } catch (err) {
    countsError = err.message;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.customers.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.customers.subtitle')}</p>
      </div>

      {result ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label={t('admin.customers.statTotal')} value={result.summary.total.toLocaleString('fr-FR')} />
          <Stat label={t('admin.customers.statLocked')} value={result.summary.locked.toLocaleString('fr-FR')} />
          <Stat label={t('admin.customers.statUnverified')} value={result.summary.unverified.toLocaleString('fr-FR')} />
        </div>
      ) : null}

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.customers.searchPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'status',
            label: t('admin.customers.colStatus'),
            options: ADMIN_CUSTOMER_STATUSES.map((value) => ({ value, label: t(STATUS_LABEL_KEYS[value]) })),
          },
        ]}
      >
        <ServerViewTools path="/admin/customers" params={params} exportDataset="customers" />
      </TableToolbar>

      {loadError ? <ErrorNote>{t('admin.customers.loadError', { error: loadError })}</ErrorNote> : null}
      {countsError ? <ErrorNote>{t('admin.customers.countsError', { error: countsError })}</ErrorNote> : null}

      <TableFrame
        minWidth="64rem"
        footer={result ? <Pagination pathname="/admin/customers" params={params} total={result.total} page={page} pageSize={pageSize} cursors={result.cursors} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.customers.colCustomer')}</th>
            <th className={TH_STICKY}>{t('admin.customers.colJoined')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.customers.colSavedSearches')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.customers.colFavorites')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.customers.colEnquiries')}</th>
            <th className={TH_STICKY}>{t('admin.customers.colStatus')}</th>
            <th className={TH_STICKY}>{t('admin.customers.colLastLogin')}</th>
            <th className={TH_STICKY}>{t('admin.customers.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8}>{t('admin.customers.empty')}</EmptyRow>
          ) : (
            rows.map((customer) => {
              const count = counts?.[customer.phone];
              return (
                <tr key={customer.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    <Link href={`/admin/customers/${customer.id}`} className="block max-w-[16rem] truncate font-semibold text-ink hover:text-blue-deep hover:underline">
                      {customer.full_name || <span className="font-normal text-ink-45">{t('admin.customers.noName')}</span>}
                    </Link>
                    <div className="u-tabular text-ink-45">+{customer.phone} · #{customer.id}</div>
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatDay(customer.created_at)}</td>
                  <td className={TD_DENSE_RIGHT}>{customer.saved_searches_count}</td>
                  <td className={TD_DENSE_RIGHT}>{customer.favorites_count}</td>
                  <td className={TD_DENSE_RIGHT}>
                    {counts ? (
                      <>
                        <span className="font-semibold text-ink">{count?.leads ?? 0}</span>
                        <div className="text-ink-45">{t('admin.customers.viewingsCount', { count: count?.viewings ?? 0 })}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className={TD_DENSE}>
                    <div className="flex flex-col items-start gap-1">
                      {customer.is_locked ? (
                        <span title={formatKinshasa(customer.locked_until)}>
                          <Chip tone="danger">{t('admin.customers.statusLocked')}</Chip>
                        </span>
                      ) : (
                        <Chip tone="success">{t('admin.customers.statusActive')}</Chip>
                      )}
                      {!customer.phone_verified_at ? <Chip tone="warning">{t('admin.customers.statusUnverified')}</Chip> : null}
                      {!customer.has_password ? <Chip>{t('admin.customers.noPassword')}</Chip> : null}
                    </div>
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{customer.last_login_at ? formatKinshasa(customer.last_login_at) : '—'}</td>
                  <td className={TD_DENSE}>
                    <CustomerRowActions
                      phone={customer.phone}
                      isLocked={customer.is_locked}
                      resetAction={adminSetCustomerPasswordAction.bind(null, customer.id)}
                      unlockAction={adminUnlockCustomerAction.bind(null, customer.id)}
                      leadsHref={`/admin/leads?wa=${encodeURIComponent(customer.phone)}`}
                    />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableFrame>
    </div>
  );
}
