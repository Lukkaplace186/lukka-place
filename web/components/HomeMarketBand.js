import HomeSectionHeader, { HOME_SECTION } from './HomeSectionHeader';
import HomeMarketExplorer from './HomeMarketExplorer';
import { getT } from '@/lib/i18n/server';
import { MIN_PRICE_SAMPLE, getPriceGuides } from '@/lib/browseFeatures';
import { communeLabel } from '@/lib/cities';
import { memo } from '@/lib/memo';
import { marketCommunes } from '@/lib/homeMarket';

/**
 * "Le marché locatif en chiffres" (2026-11-04 landing pass, from the
 * approved mockup): the price guides shown as figures on the homepage
 * instead of a plain link. Nothing here is computed for the page — it is the
 * same data /combien-coute publishes, under the same minimum of
 * MIN_PRICE_SAMPLE comparable listings.
 *
 * HomeMarketExplorer: up to four communes with the most compared listings
 * that have at least two bedroom counts between 1 and 4, then the median for
 * each bedroom count as a bar; tapping a commune or a bar changes the
 * headline figure, which links to that guide's own page.
 *
 * The Lukka Index panel that sat beside it was taken off the homepage the
 * same day (owner: not needed for now). /indice-lukka is unchanged.
 *
 * Renders nothing when there is no guide to show.
 */
export default async function HomeMarketBand() {
  const guides = await memo('home-market:v2', 60_000, () => getPriceGuides());
  const communes = marketCommunes(guides, { label: communeLabel });
  if (!communes.length) return null;

  const t = await getT();
  return (
    <section className="bg-canvas-alt">
      <div className={HOME_SECTION}>
        <HomeSectionHeader title={t('home.market.title')} href="/combien-coute" linkLabel={t('home.discovery.prices')} />
        <HomeMarketExplorer communes={communes} note={t('home.market.note', { n: MIN_PRICE_SAMPLE })} />
      </div>
    </section>
  );
}
