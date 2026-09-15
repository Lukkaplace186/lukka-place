import { AgentDashboardSkeleton } from '@/components/RouteSkeletons';
import { getT } from '@/lib/i18n/server';

/**
 * Shown beside the sidebar while an agent dashboard page renders (every one is
 * force-dynamic and waits on Postgres and the engine). Placed at the segment
 * root, so a `?tab=` switch inside one page does not flash it.
 */
export default async function AgentDashboardLoading() {
  const t = await getT();
  return <AgentDashboardSkeleton label={t('common.states.loading')} />;
}
