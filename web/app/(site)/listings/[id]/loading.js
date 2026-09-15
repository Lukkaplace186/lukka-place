import { ListingDetailSkeleton } from '@/components/RouteSkeletons';
import { getT } from '@/lib/i18n/server';

/** The detail page's shape, shown the moment a listing card is tapped — see components/RouteSkeletons.js. */
export default async function ListingDetailLoading() {
  const t = await getT();
  return <ListingDetailSkeleton label={t('common.states.loading')} />;
}
