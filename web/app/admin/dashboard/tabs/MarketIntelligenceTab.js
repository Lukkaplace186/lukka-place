import Link from 'next/link';
import { getTopCommunesByViews } from '@/lib/analytics';
import { queryPriceGuides } from '@/lib/marketGuide';
import { RENT_INDEX_BEDS, dashboardHref } from '@/lib/adminDashboardTabs';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import ClickBreakdown from '../ClickBreakdown';
import DashboardPanel from '../DashboardPanel';
import TabSection, { TD, TH, THEAD, TR } from './TabSection';

/** The price guide's own floor: a commune × bedrooms cell needs 5 rents before it has a median. */
const MIN_SAMPLE = 5;
const INDEX_ROWS = 12;

const usd = (n) => `${frNumber(Math.round(n))} $`;

/**
 * Median monthly rent by commune × bedrooms — the same blended figures as the
 * public price guide (lib/marketGuide.js: our listings plus collected market
 * observations, recent adverts weighted double). The bedroom chips are links,
 * so a filtered view is linkable like every console filter.
 */
async function RentIndex({ beds, periode }) {
  const t = await getT();
  const k = (key, vars) => t(`admin.dashboard.market.${key}`, vars);
  let guides = null;
  try {
    guides = await queryPriceGuides(MIN_SAMPLE);
  } catch {
    return <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">{k('loadError')}</p>;
  }
  const rows = guides
    .filter((g) => beds === null || Number(g.beds) === beds)
    .slice(0, INDEX_ROWS);

  return (
    <>
      <nav aria-label={k('bedsFilter')} className="mb-3 flex flex-wrap gap-1.5">
        {RENT_INDEX_BEDS.map((option) => {
          const active = option === beds;
          return (
            <Link
              key={option ?? 'all'}
              href={dashboardHref({ tab: 'marche', periode, chambres: option })}
              scroll={false}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium',
                active ? 'border-blue bg-blue text-white' : 'border-line bg-white text-ink hover:bg-canvas-alt',
              )}
            >
              {option === null ? k('bedsAll') : k('bedsN', { count: option })}
            </Link>
          );
        })}
      </nav>
      <DashboardPanel title={k('indexTable')} note={k('indexNote', { min: MIN_SAMPLE })} isEmpty={rows.length === 0}>
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className={THEAD}>
            <tr>
              <th className={TH}>{k('colCommune')}</th>
              <th className={TH}>{k('colBeds')}</th>
              <th className={`${TH} text-right`}>{k('colMedian')}</th>
              <th className={`${TH} text-right`}>{k('colRange')}</th>
              <th className={`${TH} text-right`}>{k('colSample')}</th>
              <th className={`${TH} text-right`}>{k('colLukka')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.commune}|${row.beds}`} className={TR}>
                <td className={`${TD} text-ink`}>{row.commune}</td>
                <td className={`${TD} u-tabular text-ink-70`}>{row.beds}</td>
                <td className={`${TD} u-tabular whitespace-nowrap text-right font-semibold text-ink`}>{usd(row.median)}</td>
                <td className={`${TD} u-tabular whitespace-nowrap text-right text-ink-70`}>
                  {usd(row.p25)} – {usd(row.p75)}
                </td>
                <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.listings)}</td>
                <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.lukka_listings ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DashboardPanel>
    </>
  );
}

/** "What does the market price, and where?" — the rent index, then where interest goes. */
export default async function MarketIntelligenceTab({ sinceDays, beds, periode }) {
  const t = await getT();
  const k = (key, vars) => t(`admin.dashboard.market.${key}`, vars);
  const topCommunes = await getTopCommunesByViews(10, { sinceDays });

  return (
    <div>
      <TabSection title={k('indexTitle')} note={k('indexIntro')} href="/admin/market-data/prix" linkLabel={k('seeGuide')}>
        <RentIndex beds={beds} periode={periode} />
      </TabSection>

      <ClickBreakdown sinceDays={sinceDays} parts={['commune', 'type', 'price']} title={k('interestTitle')} showIntro={false} />

      <TabSection title={t('admin.dashboard.topCommunes')} href="/admin/market-data" linkLabel={k('seeMarketData')}>
        <DashboardPanel title={k('viewsTable')} isEmpty={topCommunes.length === 0}>
          <table className="w-full min-w-[280px] text-left text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>{t('admin.dashboard.commune')}</th>
                <th className={`${TH} text-right`}>{t('admin.dashboard.views')}</th>
              </tr>
            </thead>
            <tbody>
              {topCommunes.map((row) => (
                <tr key={row.commune} className={TR}>
                  <td className={`${TD} text-ink`}>{row.commune}</td>
                  <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashboardPanel>
      </TabSection>
    </div>
  );
}
