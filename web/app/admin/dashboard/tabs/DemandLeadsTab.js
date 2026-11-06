import { getConversionByDevice, getViewsBySource } from '@/lib/analytics';
import { TAB_QUEUES } from '@/lib/adminDashboardTabs';
import { getDemand } from '@/lib/investorMetrics';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import WorkQueues from '../WorkQueues';
import ClickBreakdown from '../ClickBreakdown';
import DashboardPanel from '../DashboardPanel';
import TabSection, { TD, TH, THEAD, TR } from './TabSection';

const DEVICE_LABEL_KEYS = {
  mobile: 'admin.dashboard.deviceLabels.mobile',
  desktop: 'admin.dashboard.deviceLabels.desktop',
  tablet: 'admin.dashboard.deviceLabels.tablet',
  bot: 'admin.dashboard.deviceLabels.bot',
  inconnu: 'admin.dashboard.deviceLabels.unknown',
};

const UNMET_ROWS = 10;
const ALL_TIME_DAYS = 3650;

/** What people searched for and found nothing: the supply the market is missing. */
async function UnmetDemandTable({ sinceDays }) {
  const t = await getT();
  const k = (key, vars) => t(`admin.dashboard.unmet.${key}`, vars);
  let demand = null;
  let failed = false;
  try {
    demand = await getDemand({ days: sinceDays ?? ALL_TIME_DAYS, limit: UNMET_ROWS });
  } catch {
    failed = true;
  }

  if (failed) return <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">{k('loadError')}</p>;
  if (!demand) return <p className="text-sm text-ink-45">{k('notTracked')}</p>;

  const purposeLabel = (p) => (p === 'rent' ? k('rent') : p === 'sale' ? k('sale') : k('any'));
  return (
    <DashboardPanel
      title={k('tableTitle')}
      note={k('tableNote', { searches: frNumber(demand.zeroResults), searchers: frNumber(demand.zeroSearchers) })}
      isEmpty={demand.unmet.length === 0}
    >
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className={THEAD}>
          <tr>
            <th className={TH}>{k('colCommune')}</th>
            <th className={TH}>{k('colPurpose')}</th>
            <th className={TH}>{k('colType')}</th>
            <th className={`${TH} text-right`}>{k('colPeople')}</th>
            <th className={`${TH} text-right`}>{k('colSearches')}</th>
            <th className={`${TH} text-right`}>{k('colBudget')}</th>
          </tr>
        </thead>
        <tbody>
          {demand.unmet.map((row) => (
            <tr key={`${row.commune}|${row.purpose}|${row.propertyType}`} className={TR}>
              <td className={`${TD} text-ink`}>{row.commune || k('anyCommune')}</td>
              <td className={`${TD} text-ink-70`}>{purposeLabel(row.purpose)}</td>
              <td className={`${TD} text-ink-70`}>{row.propertyType || k('anyType')}</td>
              <td className={`${TD} u-tabular text-right text-ink`}>{frNumber(row.searchers)}</td>
              <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.searches)}</td>
              {/* A median only from 5 budgets (sampled()); fewer is "—", never a guess. */}
              <td className={`${TD} u-tabular whitespace-nowrap text-right text-ink-70`}>
                {row.medianBudget === null ? '—' : `${frNumber(Math.round(row.medianBudget))} $`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DashboardPanel>
  );
}

/** "Are customers getting answered?" — visits and conversations to act on, unmet searches, where clicks come from. */
export default async function DemandLeadsTab({ role, sinceDays }) {
  const t = await getT();
  const [bySource, conversionDevice] = await Promise.all([
    getViewsBySource({ sinceDays, limit: 10 }),
    getConversionByDevice({ sinceDays }),
  ]);

  return (
    <div>
      <WorkQueues role={role} only={TAB_QUEUES.demande} />

      <TabSection
        id="recherches-sans-resultat"
        title={t('admin.dashboard.unmet.title')}
        note={t('admin.dashboard.unmet.note')}
        href="/admin/demande"
        linkLabel={t('admin.dashboard.unmet.seeReport')}
      >
        <UnmetDemandTable sinceDays={sinceDays} />
      </TabSection>

      <ClickBreakdown sinceDays={sinceDays} parts={['audience', 'routing', 'placement', 'source']} />

      <TabSection title={t('admin.dashboard.tabs.audienceTitle')}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DashboardPanel
            title={t('admin.dashboard.devices')}
            note={t('admin.dashboard.devicesNote')}
            isEmpty={conversionDevice.length === 0}
          >
            <table className="w-full min-w-[380px] text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>{t('admin.dashboard.device')}</th>
                  <th className={TH}>{t('admin.dashboard.views')}</th>
                  <th className={TH}>{t('admin.dashboard.whatsappClicks')}</th>
                  <th className={TH}>{t('admin.dashboard.conversion')}</th>
                </tr>
              </thead>
              <tbody>
                {conversionDevice.map((row) => (
                  <tr key={row.device} className={TR}>
                    <td className={`${TD} text-ink`}>{DEVICE_LABEL_KEYS[row.device] ? t(DEVICE_LABEL_KEYS[row.device]) : row.device}</td>
                    <td className={`${TD} u-tabular text-ink-70`}>{frNumber(row.views)}</td>
                    <td className={`${TD} u-tabular text-ink-70`}>{frNumber(row.clicks)}</td>
                    {/* null, not 0%: a device with no views has no rate at all. */}
                    <td className={`${TD} u-tabular text-ink-70`}>
                      {row.rate === null ? '—' : `${(row.rate * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardPanel>

          <DashboardPanel
            title={t('admin.dashboard.trafficSource')}
            note={t('admin.dashboard.trafficSourceNote')}
            isEmpty={bySource.length === 0}
          >
            <table className="w-full min-w-[280px] text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>{t('admin.dashboard.source')}</th>
                  <th className={TH}>{t('admin.dashboard.views')}</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((row) => (
                  <tr key={row.source} className={TR}>
                    <td className={`${TD} text-ink`}>{row.source === 'direct' ? t('admin.dashboard.direct') : row.source}</td>
                    <td className={`${TD} u-tabular text-ink-70`}>{frNumber(row.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardPanel>
        </div>
      </TabSection>
    </div>
  );
}
