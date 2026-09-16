import Link from 'next/link';
import { AUDIT_ENTITY_TYPES, listAuditLog } from '@/lib/adminAudit';
import { listAdminUsers } from '@/lib/adminUsers';
import { firstParam, kinshasaDayEnd, kinshasaDayStart, parseCursor, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import ServerViewTools from '../table/ServerViewTools';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const dynamic = 'force-dynamic';

const ACTION_PREFIXES = [
  'listing', 'agent', 'agency', 'customer', 'conversation', 'lead', 'viewing', 'membership', 'package', 'featured',
  'plan_request', 'cms', 'team', 'session', 'export', 'note', 'sales', 'impersonation',
];

function entityHref(type, id) {
  if (!id) return null;
  switch (type) {
    case 'listing': return `/admin/listings/${id}`;
    case 'agent': return `/admin/agents/${id}`;
    case 'customer': return `/admin/customers/${id}`;
    case 'agency': return `/admin/agencies/${id}`;
    case 'conversation': return `/admin/conversations?c=${id}`;
    case 'lead': return `/admin/leads/${id}`;
    case 'team': return '/admin/team';
    case 'sales_rep': return `/admin/sales/${id}`;
    case 'sales_plan': return '/admin/sales/plans';
    default: return null;
  }
}

/**
 * Every mutating console action: who, what, on which entity, when, from where.
 * Owner only. Append-only — nothing in the console edits or deletes a row here.
 */
export default async function AdminAuditPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const filters = {
    actor: firstParam(raw.actor) || undefined,
    action: ACTION_PREFIXES.includes(firstParam(raw.action)) ? firstParam(raw.action) : undefined,
    entity: AUDIT_ENTITY_TYPES.includes(firstParam(raw.entity)) ? firstParam(raw.entity) : undefined,
    q: firstParam(raw.q) || undefined,
    from: /^\d{4}-\d{2}-\d{2}$/.test(firstParam(raw.from) || '') ? firstParam(raw.from) : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(firstParam(raw.to) || '') ? firstParam(raw.to) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw, { defaultSize: 50 });
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 50 ? undefined : String(pageSize) };

  const [logResult, usersResult] = await Promise.allSettled([
    listAuditLog({
      adminUserId: filters.actor === 'shared' ? 'shared' : filters.actor,
      action: filters.action ? `${filters.action}.` : undefined,
      entityType: filters.entity,
      entityId: filters.q,
      from: kinshasaDayStart(filters.from),
      to: kinshasaDayEnd(filters.to),
      limit,
      offset,
      cursor: parseCursor(raw),
    }),
    listAdminUsers(),
  ]);
  const log = logResult.status === 'fulfilled' ? logResult.value : null;
  const users = usersResult.status === 'fulfilled' ? usersResult.value : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.audit.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.audit.subtitle')}</p>
        <Link href="/admin/impersonation" className="u-micro-strong mt-1 inline-block text-blue-deep hover:underline">
          {t('admin.impersonation.logLink')}
        </Link>
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.audit.entityIdPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'actor',
            label: t('admin.audit.colActor'),
            options: [{ value: 'shared', label: t('admin.chrome.sharedSession') }, ...users.map((user) => ({ value: String(user.id), label: user.full_name }))],
          },
          { type: 'select', param: 'action', label: t('admin.audit.colAction'), options: ACTION_PREFIXES.map((value) => ({ value, label: value })) },
          { type: 'select', param: 'entity', label: t('admin.audit.colEntity'), options: AUDIT_ENTITY_TYPES.map((value) => ({ value, label: value })) },
          { type: 'date', param: 'from', label: t('admin.table.from') },
          { type: 'date', param: 'to', label: t('admin.table.to') },
        ]}
      >
        <ServerViewTools path="/admin/audit" params={params} exportDataset="audit" />
      </TableToolbar>

      {logResult.status === 'rejected' ? <ErrorNote>{t('admin.audit.loadError', { error: logResult.reason?.message })}</ErrorNote> : null}

      <TableFrame
        minWidth="64rem"
        footer={log ? <Pagination pathname="/admin/audit" params={params} total={log.total} page={page} pageSize={pageSize} cursors={log.cursors} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.audit.colTime')}</th>
            <th className={TH_STICKY}>{t('admin.audit.colActor')}</th>
            <th className={TH_STICKY}>{t('admin.audit.colAction')}</th>
            <th className={TH_STICKY}>{t('admin.audit.colEntity')}</th>
            <th className={TH_STICKY}>{t('admin.audit.colDetails')}</th>
            <th className={TH_STICKY}>{t('admin.audit.colIp')}</th>
          </tr>
        </thead>
        <tbody>
          {(log?.rows || []).length === 0 ? (
            <EmptyRow colSpan={6}>{t('admin.audit.empty')}</EmptyRow>
          ) : (
            log.rows.map((row) => {
              const href = entityHref(row.entity_type, row.entity_id);
              const details = row.details ? JSON.stringify(row.details) : '';
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD_DENSE}>{row.admin_name || (row.actor_label === 'shared-password' ? t('admin.chrome.sharedSession') : row.actor_label)}</td>
                  <td className={TD_DENSE}><code className="rounded bg-canvas-alt px-1">{row.action}</code></td>
                  <td className={TD_DENSE}>
                    {row.entity_type ? (
                      href ? (
                        <Link href={href} className="font-semibold text-blue-deep hover:underline">{row.entity_type} #{row.entity_id}</Link>
                      ) : `${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}`
                    ) : '—'}
                  </td>
                  <td className={`${TD_DENSE} max-w-[22rem]`}>
                    {details ? <span className="line-clamp-2 break-all text-ink-45" title={details}>{details}</span> : '—'}
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
