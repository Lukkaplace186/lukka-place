import { getTotalPageViews, getWhatsAppConversionRate, getViewsByDevice } from '@/lib/analytics';
import { TAB_QUEUES } from '@/lib/adminDashboardTabs';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import WorkQueues from '../WorkQueues';
import ClickBreakdown from '../ClickBreakdown';
import TabSection from './TabSection';

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="u-eyebrow text-ink-45">{label}</p>
      <p className="u-stat mt-1 text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-45">{hint}</p> : null}
    </div>
  );
}

/**
 * "Is the business moving?" — the urgent queues, the traffic behind the KPI
 * header, and the 12-week click trend. Everything else lives in its own tab.
 */
export default async function ExecutiveTab({ role, sinceDays }) {
  const t = await getT();
  const [pageViews, conversionRate, byDevice] = await Promise.all([
    getTotalPageViews({ sinceDays }),
    getWhatsAppConversionRate({ sinceDays }),
    getViewsByDevice({ sinceDays }),
  ]);

  // Bots are stored as a real bucket so the totals stay honest, but they are
  // not audience — the human share is the number worth reading.
  const humanViews = byDevice
    .filter((r) => r.device !== 'bot' && r.device !== 'inconnu')
    .reduce((sum, r) => sum + r.views, 0);
  const mobileViews = byDevice.find((r) => r.device === 'mobile')?.views ?? 0;
  const mobileShare = humanViews > 0 ? (mobileViews / humanViews) * 100 : null;

  return (
    <div>
      <WorkQueues role={role} only={TAB_QUEUES.apercu} title={t('admin.dashboard.tabs.urgentTitle')} />

      <TabSection title={t('admin.queues.trafficTitle')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={t('admin.dashboard.pageViews')} value={frNumber(pageViews)} />
          <StatCard
            label={t('admin.dashboard.conversionRate')}
            value={conversionRate === null ? t('common.shared.noData') : `${(conversionRate * 100).toFixed(1)}%`}
            hint={conversionRate === null ? null : t('admin.dashboard.conversionPeople')}
          />
          <StatCard
            label={t('admin.dashboard.mobileShare')}
            value={mobileShare === null ? t('common.shared.noData') : `${mobileShare.toFixed(0)}%`}
            hint={mobileShare === null ? null : t('admin.dashboard.excludesBots')}
          />
        </div>
      </TabSection>

      <ClickBreakdown sinceDays={sinceDays} parts={['weekly']} title={t('admin.dashboard.tabs.trendTitle')} showIntro={false} />
    </div>
  );
}
