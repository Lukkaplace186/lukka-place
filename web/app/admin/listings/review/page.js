import { redirect } from 'next/navigation';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getListingSources } from '@/lib/adminApi';
import { getCategoriesForAdmin, getListingFactsForReview } from '@/lib/adminListings';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { listModerationQueue } from '@/lib/moderationQueue';
import { reviewOrder, splitQueue } from '@/lib/moderationRow';
import ReviewMode from './ReviewMode';

export const dynamic = 'force-dynamic';

function renderTime() {
  return Date.now();
}

/**
 * Review mode: the pending listings one at a time, "À vérifier" first then
 * "Prêtes", oldest first within each (`?only=check` for the first group
 * alone). Each listing comes with every photo, the facts we extracted and
 * what the agent actually sent on WhatsApp (engine services/listingSource.js).
 * Decisions go through moderateListingsAction like the queue's buttons.
 * With `listings.edit`, the facts can be corrected in place (and approved in
 * the same gesture) through the listing page's own adminUpdateListingAction.
 */
export default async function ListingReviewPage({ searchParams }) {
  const session = await getAdminSession();
  if (!can(session?.role, 'listings.moderate')) redirect('/admin/listings');
  const raw = (await searchParams) || {};
  const only = ['check', 'ready'].includes(raw.only) ? raw.only : null;
  const now = renderTime();

  const queue = await listModerationQueue({ status: 'pending', limit: 100 });
  const ordered = reviewOrder(queue.rows, now, { only });
  const ids = ordered.map((row) => row.id);
  const canEdit = can(session?.role, 'listings.edit');
  const [factsResult, sourcesResult, locationsResult, categoriesResult] = await Promise.allSettled([
    getListingFactsForReview(ids),
    getListingSources(ids),
    canEdit ? getLocationHierarchyWithFallback({ city: 'all' }) : null,
    canEdit ? getCategoriesForAdmin() : null,
  ]);
  if (sourcesResult.status === 'rejected') {
    console.error(`[admin] review mode: listing sources failed: ${sourcesResult.reason?.message}`);
  }
  const facts = factsResult.status === 'fulfilled' ? factsResult.value : new Map();
  const sources = sourcesResult.status === 'fulfilled' ? sourcesResult.value : null;
  const { check, ready } = splitQueue(ordered, now);
  // The editor needs the canonical communes (the action re-checks against
  // them) and the real categories; without either it is not offered.
  const editing = canEdit && factsResult.status === 'fulfilled'
    && locationsResult.status === 'fulfilled' && locationsResult.value?.communes?.length
    && categoriesResult.status === 'fulfilled'
    ? { communes: locationsResult.value.communes, locations: locationsResult.value.locations || {}, categories: categoriesResult.value }
    : null;

  const items = ordered.map((row) => ({
    ...row,
    facts: facts.get(row.id) || null,
    source: sources ? sources[row.id] || null : null,
    // The engine could not be asked: "message unavailable", not "no message".
    sourceUnavailable: !sources,
  }));

  return (
    <ReviewMode
      items={items}
      renderedAt={now}
      counts={{ check: check.length, ready: ready.length, total: queue.total }}
      only={only}
      editing={editing}
    />
  );
}
