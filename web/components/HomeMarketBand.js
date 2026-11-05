import HomeSectionHeader, { HOME_SECTION } from './HomeSectionHeader';
import HomeMarketExplorer from './HomeMarketExplorer';
import { getT } from '@/lib/i18n/server';
import { getPriceGuides } from '@/lib/browseFeatures';
import { DEFAULT_CITY, cityOfCommune, communeLabel } from '@/lib/cities';
import { memo } from '@/lib/memo';
import { marketCommunes } from '@/lib/homeMarket';

/**
 * "Le marché locatif en chiffres" (2026-11-04 landing pass, from the
 * approved mockup): the price guides shown as figures on the homepage
 * instead of a plain link. Nothing here is computed for the page — it is the
 * same data /combien-coute publishes, under the same minimum of
 * MIN_PRICE_SAMPLE comparable listings.
 *
 * HomeMarketExplorer: every Kinshasa commune with a guide for 1–4 bedrooms
 * (lib/homeMarket.js), the median for each bedroom count as a bar; tapping a
 * commune or a bar changes the headline figure, which links to that guide's
 * own page. Other cities (Lubumbashi) stay on /combien-coute but are left
 * off the homepage for now (owner, 2026-11-04), and the card shows no
 * listing counts (same day) — the guide page still states them.
 *
 * The Lukka Index panel that sat beside it was taken off the homepage the
 * same day (owner: not needed for now). /indice-lukka is unchanged.
 *
 * Renders nothing when there is no guide to show.
 */
export default async function HomeMarketBand() {
  const guides = await memo('home-market:v2', 60_000, () => getPriceGuides());
  const communes = marketCommunes(guides, {
    label: communeLabel,
    keep: (commune) => cityOfCommune(commune) === DEFAULT_CITY,
  });
  if (!communes.length) return null;

  const t = await getT();
  return (
    <section className="bg-canvas-alt">
      <div className={HOME_SECTION}>
        <HomeSectionHeader title={t('home.market.title')} href="/combien-coute" linkLabel={t('home.discovery.prices')} />
        <HomeMarketExplorer communes={communes} note={t('home.market.note')} />
      </div>
    </section>
  );
}
