import { SitePageSkeleton } from '@/components/RouteSkeletons';
import { getT } from '@/lib/i18n/server';

/**
 * Shown under the header while any public page without its own loading.js
 * renders — see components/RouteSkeletons.js. It wraps the `(site)` child
 * segments, so a filter or page change INSIDE /listings (same segment, new
 * search params) does not flash it: the results and the map stay mounted.
 */
export default async function SiteLoading() {
  const t = await getT();
  return <SitePageSkeleton label={t('common.states.loading')} />;
}
