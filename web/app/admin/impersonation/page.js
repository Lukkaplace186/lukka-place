import Link from 'next/link';
import { listImpersonationSessions } from '@/lib/impersonation';
import { firstParam, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const dynamic = 'force-dynamic';

function duration(start, end) {
  if (!start || !end) return null;
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Every "view as" session: who looked at whose account, why, for how long.
 * Owner only, like the audit log it complements.
 */
export default async function AdminImpersonationLogPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const target = ['agent', 'customer'].includes(firstParam(raw.target)) ? firstParam(raw.target) : undefined;
  const { page, pageSize, limit, offset } = parsePage(raw, { defaultSize: 50 });
  const params = { target, page: page > 1 ? String(page) : undefined, size: pageSize === 50 ? undefined : String(pageSize) };

  let log = null;
  let loadError = null;
  try {
    log = await listImpersonationSessions({ targetType: target, limit, offset });
  } catch (err) {
    loadError = err.message;
  }
  const now = new Date().getTime();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/audit" className="u-micro-strong text-ink-45 hover:text-ink">{t('admin.impersonation.backToAudit')}</Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.impersonation.logTitle')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.impersonation.logSubtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[undefined, 'agent', 'customer'].map((value) => (
          <Link
            key={value || 'all'}
            href={value ? `/admin/impersonation?target=${value}` : '/admin/impersonation'}
            aria-current={value === target ? 'page' : undefined}
            className={`u-micro-strong rounded-full border px-3 py-1 ${value === target ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
          >
            {value ? t(value === 'agent' ? 'common.impersonation.roleAgent' : 'common.impersonation.roleCustomer') : t('admin.table.all')}
          </Link>
        ))}
      </div>

      {loadError ? <ErrorNote>{t('admin.impersonation.loadError', { error: loadError })}</ErrorNote> : null}

      <TableFrame
        minWidth="64rem"
        footer={log ? <Pagination pathname="/admin/impersonation" params={params} total={log.total} page={page} pageSize={pageSize} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.impersonation.colStarted')}</th>
            <th className={TH_STICKY}>{t('admin.impersonation.colAdmin')}</th>
            <th className={TH_STICKY}>{t('admin.impersonation.colTarget')}</th>
            <th className={TH_STICKY}>{t('admin.impersonation.colReason')}</th>
            <th className={TH_STICKY}>{t('admin.impersonation.colEnded')}</th>
            <th className={TH_STICKY}>{t('admin.audit.colIp')}</th>
          </tr>
        </thead>
        <tbody>
          {(log?.rows || []).length === 0 ? (
            <EmptyRow colSpan={6}>{t('admin.impersonation.empty')}</EmptyRow>
          ) : (
            log.rows.map((row) => {
              const open = !row.ended_at && new Date(row.expires_at).getTime() > now;
              const href = row.target_type === 'agent' ? `/admin/agents/${row.target_id}` : `/admin/customers/${row.target_id}`;
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.started_at)}</td>
                  <td className={TD_DENSE}>{row.admin_name}</td>
                  <td className={TD_DENSE}>
                    <Link href={href} className="font-semibold text-blue-deep hover:underline">{row.target_label || `#${row.target_id}`}</Link>
                    <div className="text-ink-45">{t(row.target_type === 'agent' ? 'common.impersonation.roleAgent' : 'common.impersonation.roleCustomer')} #{row.target_id}</div>
                  </td>
                  <td className={`${TD_DENSE} max-w-[22rem] break-words`}>{row.reason}</td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>
                    {open ? <Chip tone="warning">{t('admin.impersonation.stillOpen')}</Chip> : (
                      <>
                        <div>{row.ended_at ? formatKinshasa(row.ended_at) : t('admin.impersonation.endReason.expired')}</div>
                        <div className="text-ink-45">
                          {[row.end_reason ? t(`admin.impersonation.endReason.${row.end_reason}`) : null, duration(row.started_at, row.ended_at)].filter(Boolean).join(' · ')}
                        </div>
                      </>
                    )}
                  </td>
                  <td className={`${TD_DENSE} u-tabular text-ink-45`}>{row.ip || '—'}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableFrame>
    </div>
  );
}
