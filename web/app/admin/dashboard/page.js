import { Suspense } from 'react';
import Link from 'next/link';
import { CLICK_PERIODS, DEFAULT_CLICK_PERIOD, parseClickPeriod } from '@/lib/analytics';
import { dashboardHref, parseDashboardTab, parseRentBeds, visibleDashboardTabs } from '@/lib/adminDashboardTabs';
import { getT } from '@/lib/i18n/server';
import { getAdminSession } from '@/lib/adminSession';
import { cn } from '@/lib/utils';
import KpiHeader from './KpiHeader';
import SignupGoal from './SignupGoal';
import ExecutiveTab from './tabs/ExecutiveTab';
import DemandLeadsTab from './tabs/DemandLeadsTab';
import SupplyVerificationTab from './tabs/SupplyVerificationTab';
import MarketIntelligenceTab from './tabs/MarketIntelligenceTab';

// Plain async Server Component with no searchParams/cookies() call of its
// own doesn't trip Next's automatic dynamic-rendering detection, even though
// it queries live, frequently-changing data — without this it would
// statically prerender at build time and serve a frozen snapshot forever.
export const dynamic = 'force-dynamic';

function TabSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-canvas-alt" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-card bg-canvas-alt" />
    </div>
  );
}

/**
 * The console's home: four headline figures, then four tabs that each answer
 * one question (Executive / Demand & leads / Supply & verification / Market).
 * Tab, period and filters live in the URL; only the open tab's queries run.
 */
export default async function AdminDashboardPage({ searchParams }) {
  const t = await getT();
  const session = await getAdminSession();
  const sp = await searchParams;
  const role = session?.role;
  const period = parseClickPeriod(sp?.periode);
  const sinceDays = period.days;
  const tabs = visibleDashboardTabs(role);
  const tab = parseDashboardTab(sp?.tab, role);
  const beds = parseRentBeds(sp?.chambres);
  // The default period stays out of the URL, as before.
  const periode = period.key === DEFAULT_CLICK_PERIOD ? null : period.key;
  const periodLabel = t(`admin.dashboard.periods.${period.key}`);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.dashboard.title')}</h1>
          <p className="mt-1 text-sm text-ink-45">{t('admin.dashboard.basisNote')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* URL-driven like every console filter, so a period is linkable. It applies to every tab. */}
          <nav aria-label={t('admin.dashboard.period')} className="flex flex-wrap gap-1.5">
            {CLICK_PERIODS.map((p) => {
              const active = p.key === period.key;
              return (
                <Link
                  key={p.key}
                  href={dashboardHref({ tab: tab.key, periode: p.key === DEFAULT_CLICK_PERIOD ? null : p.key })}
                  scroll={false}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium',
                    active ? 'border-blue bg-blue text-white' : 'border-line bg-white text-ink hover:bg-canvas-alt',
                  )}
                >
                  {t(`admin.dashboard.periods.${p.key}`)}
                </Link>
              );
            })}
          </nav>
          {/* A plain link, not a button: this is a GET that streams a file. */}
          <a
            href="/admin/export/listings.csv"
            className="inline-flex min-h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-canvas-alt"
          >
            {t('admin.dashboard.exportCsv')}
          </a>
        </div>
      </div>

      <Suspense fallback={null}>
        <SignupGoal role={role} />
      </Suspense>

      <Suspense fallback={<div aria-hidden="true" className="mb-6 h-28 animate-pulse rounded-card bg-canvas-alt" />}>
        <KpiHeader sinceDays={sinceDays} periodLabel={periodLabel} />
      </Suspense>

      {/* Links, not ARIA tabs: each one is a navigation to a linkable view. */}
      <nav
        aria-label={t('admin.dashboard.tabs.label')}
        className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line px-1"
      >
        {tabs.map((item) => {
          const active = item.key === tab.key;
          return (
            <Link
              key={item.key}
              href={dashboardHref({ tab: item.key, periode })}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors',
                active ? 'border-blue text-blue' : 'border-transparent text-ink-45 hover:text-ink',
              )}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <Suspense key={`${tab.key}|${period.key}|${beds ?? ''}`} fallback={<TabSkeleton />}>
        {tab.key === 'apercu' ? <ExecutiveTab role={role} sinceDays={sinceDays} /> : null}
        {tab.key === 'demande' ? <DemandLeadsTab role={role} sinceDays={sinceDays} /> : null}
        {tab.key === 'offre' ? <SupplyVerificationTab role={role} sinceDays={sinceDays} /> : null}
        {tab.key === 'marche' ? <MarketIntelligenceTab sinceDays={sinceDays} beds={beds} periode={periode} /> : null}
      </Suspense>
    </div>
  );
}
