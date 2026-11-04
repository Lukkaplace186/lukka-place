import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import HomeSectionHeader, { HOME_SECTION } from './HomeSectionHeader';
import HomeMarketExplorer from './HomeMarketExplorer';
import { getT, getLocale } from '@/lib/i18n/server';
import { MIN_PRICE_SAMPLE, getLukkaIndex, getPriceGuides } from '@/lib/browseFeatures';
import { communeLabel } from '@/lib/cities';
import { frNumber } from '@/lib/format';
import { memo } from '@/lib/memo';
import { marketCommunes } from '@/lib/homeMarket';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Le marché locatif en chiffres" (2026-11-04 landing pass, from the
 * approved mockup): the price guides and the Lukka Index shown as figures
 * on the homepage instead of two plain links. Nothing here is computed for
 * the page — it is the same data /combien-coute and /indice-lukka publish,
 * under the same minimum of MIN_PRICE_SAMPLE comparable listings.
 *
 *  - Left (HomeMarketExplorer): up to four communes with the most compared
 *    listings that have at least two bedroom counts between 1 and 4, then
 *    the median for each bedroom count as a bar; tapping a commune or a bar
 *    changes the headline figure, which links to that guide's own page.
 *  - Right: the latest Lukka Index, top six communes. The month-on-month
 *    change prints only where the index computed one; there is no trend
 *    line, because the index has one month so far and a line through one
 *    point would be invented.
 *
 * Renders nothing when neither source has anything to show.
 */
const MAX_INDEX_ROWS = 6;

export default async function HomeMarketBand() {
  const [guides, index] = await memo('home-market', 60_000, () => Promise.all([getPriceGuides(), getLukkaIndex()]));
  const communes = marketCommunes(guides, { label: communeLabel });
  const indexRows = (index?.communes || []).slice(0, MAX_INDEX_ROWS);
  if (!communes.length && !indexRows.length) return null;

  const t = await getT();
  const locale = await getLocale();
  const month = index?.month
    ? new Date(`${index.month}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
  const indexMax = Math.max(1, ...indexRows.map((row) => row.median));
  const anyChange = indexRows.some((row) => row.changePct != null);
  const both = communes.length && indexRows.length;

  return (
    <section className="bg-canvas-alt">
      <div className={HOME_SECTION}>
        <HomeSectionHeader title={t('home.market.title')} href="/combien-coute" linkLabel={t('home.discovery.prices')} />
        {/* minmax(0, …) columns at every width: an auto column grows to its
            content's min-content (the commune chips, the bar row) and pushed
            the panel past a phone's edge. */}
        <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6 ${both ? 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]' : ''}`}>
          {communes.length ? (
            <HomeMarketExplorer communes={communes} note={t('home.market.note', { n: MIN_PRICE_SAMPLE })} />
          ) : null}

          {indexRows.length ? (
            <div className="flex flex-col gap-5 rounded-2xl bg-surface p-5 sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[1.0625rem] font-bold text-ink">{t('home.index.title')}</h3>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-45">{t('home.market.indexLead')}</p>
                </div>
                {month ? (
                  <span className="shrink-0 rounded-full bg-blue-tint px-2.5 py-1 text-[0.75rem] font-semibold capitalize text-blue-deep">{month}</span>
                ) : null}
              </div>
              <ol className="flex flex-col gap-3.5">
                {indexRows.map((row) => (
                  <li key={row.commune} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3">
                    <span className="truncate text-[0.875rem] font-semibold text-ink">{communeLabel(row.commune)}</span>
                    <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-canvas-deep">
                      <span className="block h-full rounded-full bg-blue-deep" style={{ width: `${Math.round((row.median / indexMax) * 100)}%` }} />
                    </span>
                    <span className="u-tabular text-right text-[0.875rem] font-bold text-ink">
                      {frNumber(row.median)} $
                      {row.changePct != null ? (
                        <span className={`ml-1.5 text-[0.75rem] font-semibold ${row.changePct > 0 ? 'text-ink-70' : 'text-ink-45'}`}>
                          {`${row.changePct > 0 ? '+' : ''}${frNumber(row.changePct)} %`}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                {anyChange ? null : <p className="min-w-0 flex-1 text-[0.75rem] leading-relaxed text-ink-45">{t('home.market.indexNoChange')}</p>}
                <Link href="/indice-lukka" className="group inline-flex shrink-0 items-center gap-1.5 text-[0.875rem] font-semibold text-blue-deep hover:text-ink">
                  {t('home.market.indexLink')}
                  <ArrowRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
