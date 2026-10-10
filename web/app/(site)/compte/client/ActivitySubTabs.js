import SavedSubTabs from './SavedSubTabs';
import { getT } from '@/lib/i18n/server';

export { activityCounts, isVisitInquiry } from '@/lib/clientPortalView';

/**
 * The switch inside the Activité tab: Visites | Recherches.
 *
 * Two real pages (`/compte/client/visites`, `/compte/client/messages`), one
 * tab. What separates them is one rule, used by both pages and by the counts
 * here so they cannot disagree: a lead with a viewing request behind it is a
 * VISIT (`isVisitInquiry`, lib/clientPortalView.js). Before 2026-10-10 the Demandes list also showed
 * those leads, so every booking appeared in two tabs.
 */

/** `counts: null` when the engine could not answer — labels then carry no number. */
export default async function ActivitySubTabs({ view, counts = null }) {
  const t = await getT();
  const withCount = (label, n) => (counts && n > 0 ? `${label} (${n})` : label);
  return (
    <SavedSubTabs
      view={view}
      tabs={[
        { key: 'visites', href: '/compte/client/visites', label: withCount(t('account.activity.tabs.visits'), counts?.visits) },
        { key: 'recherches', href: '/compte/client/messages', label: withCount(t('account.activity.tabs.requests'), counts?.requests) },
      ]}
    />
  );
}
