import { SitePageSkeleton } from '@/components/RouteSkeletons';
import { getT } from '@/lib/i18n/server';

/**
 * The public pages' skeleton (components/RouteSkeletons.js), re-exported as
 * loading.js by each section of (site) rather than once at (site)/loading.js.
 *
 * Why not once: a loading.js is a Suspense boundary, and once its fallback has
 * been sent the response is already 200 — a notFound() below it can only add
 * <meta name="robots" content="noindex">. With one boundary over all of (site),
 * every dead listing and unknown /location/… URL answered 200, which search
 * engines treat as a soft 404. /listings/[id], /location and /vente therefore
 * sit outside any section skeleton and check existence in their own layout,
 * above their own loading.js, so a missing page is a real 404.
 *
 * The home page and the /listings results live in route groups ((home),
 * listings/(search)/(results)) so their boundary still sits above the segment
 * that changes with search params: a filter or page change inside /listings
 * does not flash it, and the results and the map stay mounted.
 */
export default async function SiteLoading() {
  const t = await getT();
  return <SitePageSkeleton label={t('common.states.loading')} />;
}
