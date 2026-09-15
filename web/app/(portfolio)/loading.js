import { SitePageSkeleton } from '@/components/RouteSkeletons';
import { getT } from '@/lib/i18n/server';

/** /agents and /agents/[id] — see components/RouteSkeletons.js. */
export default async function PortfolioLoading() {
  const t = await getT();
  return <SitePageSkeleton label={t('common.states.loading')} />;
}
