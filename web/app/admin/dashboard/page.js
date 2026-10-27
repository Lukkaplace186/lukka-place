import Link from 'next/link';
import {
  CLICK_PERIODS,
  getTotalPageViews,
  getTopCommunesByViews,
  getWhatsAppClickTotals,
  getWhatsAppConversionRate,
  getViewsByDevice,
  getViewsBySource,
  getConversionByDevice,
  parseClickPeriod,
  trendPercent,
} from '@/lib/analytics';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import { getAdminSession } from '@/lib/adminSession';
import WorkQueues from './WorkQueues';
import DashboardPanel from './DashboardPanel';
import ClickBreakdown from './ClickBreakdown';

// Plain async Server Component with no searchParams/cookies() call of its
// own doesn't trip Next's automatic dynamic-rendering detection, even though
// it queries live, frequently-changing data — without this it would
// statically prerender at build time and serve a frozen snapshot forever.
export const dynamic = 'force-dynamic';

const DEVICE_LABELS_FR = {
  mobile: 'Mobile',
  desktop: 'Ordinateur',
  tablet: 'Tablette',
  bot: 'Robots d’indexation',
  inconnu: 'Inconnu (avant le suivi)',
};

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="u-eyebrow text-ink-45">{label}</p>
      <p className="u-stat mt-1 text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-45">{hint}</p> : null}
    </div>
  );
}

function signedPercent(delta) {
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${frNumber(Math.abs(delta))} %`;
}

export default async function AdminDashboardPage({ searchParams }) {
  const t = await getT();
  const session = await getAdminSession();
  const period = parseClickPeriod((await searchParams)?.periode);
  const sinceDays = period.days;

  const [pageViews, clickTotals, topCommunes, conversionRate, byDevice, bySource, conversionDevice] =
    await Promise.all([
      getTotalPageViews({ sinceDays }),
      getWhatsAppClickTotals({ sinceDays }),
      getTopCommunesByViews(10, { sinceDays }),
      getWhatsAppConversionRate({ sinceDays }),
      getViewsByDevice({ sinceDays }),
      getViewsBySource({ sinceDays, limit: 10 }),
      getConversionByDevice({ sinceDays }),
    ]);

  // Bots are stored as a real bucket so the totals stay honest, but they are
  // not audience — the human share is the number worth reading.
  const humanViews = byDevice
    .filter((r) => r.device !== 'bot' && r.device !== 'inconnu')
    .reduce((sum, r) => sum + r.views, 0);
  const mobileViews = byDevice.find((r) => r.device === 'mobile')?.views ?? 0;
  const mobileShare = humanViews > 0 ? (mobileViews / humanViews) * 100 : null;

  // The headline is people only; what was left out and why sits under it.
  const clickDelta = clickTotals.previous === null ? null : trendPercent(clickTotals.people, clickTotals.previous);
  const clickHint = [
    clickTotals.uniqueVisitors !== null
      ? t('admin.dashboard.hintVisitors', { count: frNumber(clickTotals.uniqueVisitors) })
      : null,
    clickDelta !== null ? t('admin.dashboard.hintDelta', { delta: signedPercent(clickDelta) }) : null,
    clickTotals.excluded > 0 ? t('admin.dashboard.hintExcluded', { count: frNumber(clickTotals.excluded) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.dashboard.title')}</h1>
          <p className="mt-1 text-sm text-ink-45">
            {t('admin.dashboard.basisNote')}
          </p>
        </div>

        {/* A plain link, not a button: this is a GET that streams a file, so
            it needs no client JS and works with right-click → save as. */}
        <a
          href="/admin/export/listings.csv"
          className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-canvas-alt"
        >
          {t('admin.dashboard.exportCsv')}
        </a>
      </div>

      <WorkQueues role={session?.role} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="u-title-section text-ink">{t('admin.queues.trafficTitle')}</h2>
        {/* URL-driven like every console filter, so a period is linkable. */}
        <nav aria-label={t('admin.dashboard.period')} className="flex flex-wrap gap-1.5">
          {CLICK_PERIODS.map((p) => {
            const active = p.key === period.key;
            return (
              <Link
                key={p.key}
                href={`/admin/dashboard?periode=${p.key}`}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium ${
                  active ? 'border-blue bg-blue text-white' : 'border-line bg-white text-ink hover:bg-canvas-alt'
                }`}
              >
                {t(`admin.dashboard.periods.${p.key}`)}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('admin.dashboard.pageViews')} value={frNumber(pageViews)} />
        <StatCard
          label={t('admin.dashboard.whatsappPeople')}
          value={frNumber(clickTotals.people)}
          hint={clickHint || null}
        />
        <StatCard
          label={t('admin.dashboard.conversionRate')}
          value={conversionRate === null ? t('common.shared.noData') : `${(conversionRate * 100).toFixed(1)}%`}
          hint={conversionRate === null ? null : t('admin.dashboard.conversionPeople')}
        />
        <StatCard
          label="Part mobile"
          value={mobileShare === null ? t('common.shared.noData') : `${mobileShare.toFixed(0)}%`}
          hint={mobileShare === null ? null : t('admin.dashboard.excludesBots')}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardPanel
          title={t('admin.dashboard.devices')}
          note="Déduit de l’en-tête User-Agent, jamais du contenu envoyé par le navigateur."
          isEmpty={byDevice.length === 0}
        >
          <table className="w-full min-w-[380px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t('admin.dashboard.device')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('admin.dashboard.views')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('admin.dashboard.whatsappClicks')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('admin.dashboard.conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {conversionDevice.map((row) => (
                <tr key={row.device} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{DEVICE_LABELS_FR[row.device] || row.device}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{frNumber(row.views)}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{frNumber(row.clicks)}</td>
                  {/* null, not 0%: a device with no views has no rate at all,
                      and "0%" would read as "nobody converts" instead of
                      "nobody visited". */}
                  <td className="u-tabular px-4 py-2.5 text-ink-70">
                    {row.rate === null ? '—' : `${(row.rate * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashboardPanel>

        <DashboardPanel
          title={t('admin.dashboard.trafficSource')}
          note="Domaine référent uniquement (jamais l’URL complète), ou l’étiquette utm_source d’une campagne."
          isEmpty={bySource.length === 0}
        >
          <table className="w-full min-w-[280px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t('admin.dashboard.source')}</th>
                <th className="px-4 py-2.5 font-semibold">Vues</th>
              </tr>
            </thead>
            <tbody>
              {bySource.map((row) => (
                <tr key={row.source} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{row.source === 'direct' ? t('admin.dashboard.direct') : row.source}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{frNumber(row.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashboardPanel>

        <DashboardPanel title={t('admin.dashboard.topCommunes')} isEmpty={topCommunes.length === 0}>
          <table className="w-full min-w-[280px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t('admin.dashboard.commune')}</th>
                <th className="px-4 py-2.5 font-semibold">Vues</th>
              </tr>
            </thead>
            <tbody>
              {topCommunes.map((row) => (
                <tr key={row.commune} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{row.commune}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{frNumber(row.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashboardPanel>
      </div>

      <ClickBreakdown sinceDays={sinceDays} />
    </div>
  );
}
