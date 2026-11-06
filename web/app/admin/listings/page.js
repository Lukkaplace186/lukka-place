import Link from 'next/link';
import { getLocationHierarchySafe } from '@/lib/locations';
import { firstParam, parseCursor, parsePage, buildHref } from '@/lib/adminPagination';
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
import { SOCIAL_FILTERS, getTeamSocialPostsByListing } from '@/lib/teamSocialPosts';
import { TEAM_SOCIAL_TARGETS } from '@/lib/teamSocialTargets';

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
    // Where the team posted it (team_social_posts): live listings only.
    social: status === 'approved' && SOCIAL_FILTERS.includes(firstParam(raw.social)) ? firstParam(raw.social) : undefined,
    notIn: status === 'approved' && TEAM_SOCIAL_TARGETS.some((target) => target.key === firstParam(raw.notIn)) ? firstParam(raw.notIn) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  const session = await getAdminSession();
  const [queueResult, countsResult, locations] = await Promise.allSettled([
    listModerationQueue({ ...filters, status, limit, offset, cursor: parseCursor(raw) }),
    getModerationCounts(),
    getLocationHierarchySafe(),
  ]);
  const queue = queueResult.status === 'fulfilled' ? queueResult.value : null;
  const counts = countsResult.status === 'fulfilled' ? countsResult.value : {};
  const communes = locations.status === 'fulfilled' ? locations.value.communes || [] : [];

  // "Publié sur" on the live tab: where the team already posted each row.
  // null = not known (table missing or the read failed), never "nowhere".
  let socialPosts = null;
  if (status === 'approved' && queue?.rows?.length) {
    try {
      const map = await getTeamSocialPostsByListing(queue.rows.map((row) => row.id));
      socialPosts = map ? Object.fromEntries(map) : null;
    } catch (err) {
      console.error(`[team-social] reading posts for /admin/listings failed: ${err.message}`);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.listings.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.moderation.subtitle')}</p>
        </div>
        {can(session?.role, 'listings.edit') ? (
          <Link
            href="/admin/listings/nouveau"
            className="u-btn-primary u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-bold"
          >
            + {t('admin.listings.create')}
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {MODERATION_QUEUE_STATUSES.map((value) => (
          <Link
            key={value}
            href={buildHref('/admin/listings', params, { status: value === 'pending' ? '' : value, flag: '', sort: '', social: '', notIn: '' })}
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
        resetKeys={['q', 'commune', 'purpose', 'flag', 'sort', 'social', 'notIn']}
        filters={[
          ...(status === 'approved'
            ? [
              {
                type: 'select',
                param: 'social',
                label: t('admin.social.filterLabel'),
                options: [
                  { value: 'unposted', label: t('admin.social.filterUnposted') },
                  { value: 'posted', label: t('admin.social.filterPosted') },
                ],
              },
              {
                type: 'select',
                param: 'notIn',
                label: t('admin.social.notInLabel'),
                options: TEAM_SOCIAL_TARGETS.map((target) => ({ value: target.key, label: target.label })),
              },
            ]
            : []),
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
        canDelete={can(session?.role, 'listings.delete')}
        renderedAt={renderTime()}
        socialPosts={socialPosts}
        footer={queue ? <Pagination pathname="/admin/listings" params={params} total={queue.total} page={page} pageSize={pageSize} cursors={queue.cursors} /> : null}
      />

      {status === 'pending' ? <NewItemsNotice keys={['pendingListings']} /> : null}
    </div>
  );
}
