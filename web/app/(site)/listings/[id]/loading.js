import { ListingDetailSkeleton } from '@/components/RouteSkeletons';
import { AppListingSkeleton } from '@/components/app/AppSkeletons';
import { isAppRequest } from '@/lib/appMode';
import { getT } from '@/lib/i18n/server';

/** The detail page's shape, shown the moment a listing card is tapped — see components/RouteSkeletons.js. */
export default async function ListingDetailLoading() {
  const t = await getT();
  // Inside the store app: the photo to the top of the screen, as the page itself.
  if (await isAppRequest()) return <AppListingSkeleton label={t('common.states.loading')} />;
  return <ListingDetailSkeleton label={t('common.states.loading')} />;
}
