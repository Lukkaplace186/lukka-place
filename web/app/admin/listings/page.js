import Link from 'next/link';
import { getLocationHierarchySafe } from '@/lib/locations';
import { firstParam, parsePage, buildHref } from '@/lib/adminPagination';
import { FILTERABLE_FLAGS, MODERATION_SORTS, getModerationCounts, listModerationQueue } from '@/lib/moderationQueue';
import { MODERATION_QUEUE_STATUSES, QUALITY_FLAG_LABEL_KEYS } from '@/lib/moderation';
import { LISTING_MODERATION_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import { ErrorNote } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { NewItemsNotice } from '../LiveQueueCounts';
import ModerationTable from './ModerationTable';
import ServerViewTools from '../table/ServerViewTools';

export const dynamic = 'force-dynamic';

/** The request's render time, handed to the client table so both sides compute the same waiting times. */
function renderTime() {
  return Date.now();
}

const SORT_LABEL_KEYS = {
  oldest: 'admin.moderation.sortOldest',
  newest: 'admin.moderation.sortNewest',
  price_asc: 'admin.moderation.sortPriceAsc',
  price_desc: 'admin.moderation.sortPriceDesc',
  moderated: 'admin.moderation.sortModerated',
};

/**
 * The approval queue. Pending listings, oldest first with their waiting time;
 * quality flags on every row; search by id, reference, title, agent or phone;
 * filters by commune, transaction and flag; bulk approve and bulk reject with a
 * reason the agent is actually told. One server page at a time.
 */
export default async function AdminListingsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const status = MODERATION_QUEUE_STATUSES.includes(firstParam(raw.status)) ? firstParam(raw.status) : 'pending';
  const filters = {
    status: status === 'pending' ? undefined : status,
    q: firstParam(raw.q) || undefined,
    commune: firstParam(raw.commune) || undefined,
    purpose: ['rent', 'sale'].includes(firstParam(raw.purpose)) ? firstParam(raw.purpose) : undefined,
    flag: FILTERABLE_FLAGS.includes(firstParam(raw.flag)) ? firstParam(raw.flag) : undefined,
    sort: MODERATION_SORTS.includes(firstParam(raw.sort)) ? firstParam(raw.sort) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  const session = await getAdminSession();
  const [queueResult, countsResult, locations] = await Promise.allSettled([
    listModerationQueue({ ...filters, status, limit, offset }),
    getModerationCounts(),
    getLocationHierarchySafe(),
  ]);
  const queue = queueResult.status === 'fulfilled' ? queueResult.value : null;
  const counts = countsResult.status === 'fulfilled' ? countsResult.value : {};
  const communes = locations.status === 'fulfilled' ? locations.value.communes || [] : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.listings.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.moderation.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {MODERATION_QUEUE_STATUSES.map((value) => (
          <Link
            key={value}
            href={buildHref('/admin/listings', params, { status: value === 'pending' ? '' : value, flag: '', sort: '' })}
            scroll={false}
            aria-current={value === status ? 'page' : undefined}
            className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${
              value === status ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'
            }`}
          >
            {t(LISTING_MODERATION_STATUS_LABEL_KEYS[value])}
            <span className={`u-tabular ${value === 'pending' && counts.pending ? 'text-danger' : 'text-ink-45'}`}>{counts[value] ?? '—'}</span>
          </Link>
        ))}
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.moderation.searchPlaceholder') }}
        resetKeys={['q', 'commune', 'purpose', 'flag', 'sort']}
        filters={[
          {
            type: 'select',
            param: 'commune',
            label: t('admin.moderation.colCommune'),
            options: [{ value: '__none__', label: t('admin.moderation.noCommune') }, ...communes.map((name) => ({ value: name, label: name }))],
          },
          {
            type: 'select',
            param: 'purpose',
            label: t('admin.moderation.purpose'),
            options: [
              { value: 'rent', label: t('admin.marketData.rent') },
              { value: 'sale', label: t('admin.marketData.sale') },
            ],
          },
          {
            type: 'select',
            param: 'flag',
            label: t('admin.moderation.flagFilter'),
            options: FILTERABLE_FLAGS.map((value) => ({ value, label: t(QUALITY_FLAG_LABEL_KEYS[value]) })),
          },
          {
            type: 'select',
            param: 'sort',
            label: t('admin.agents.sortBy'),
            allLabel: t(status === 'pending' ? SORT_LABEL_KEYS.oldest : SORT_LABEL_KEYS.newest),
            options: MODERATION_SORTS.map((value) => ({ value, label: t(SORT_LABEL_KEYS[value]) })),
          },
        ]}
      >
        <ServerViewTools path="/admin/listings" params={params} exportDataset="listings" />
      </TableToolbar>

      {queueResult.status === 'rejected' ? (
        <ErrorNote>{t('admin.moderation.loadError', { error: queueResult.reason?.message })}</ErrorNote>
      ) : null}

      <ModerationTable
        rows={queue?.rows || []}
        status={status}
        canModerate={can(session?.role, 'listings.moderate')}
        renderedAt={renderTime()}
        footer={queue ? <Pagination pathname="/admin/listings" params={params} total={queue.total} page={page} pageSize={pageSize} /> : null}
      />

      {status === 'pending' ? <NewItemsNotice keys={['pendingListings']} /> : null}
    </div>
  );
}
