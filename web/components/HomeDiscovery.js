import Link from 'next/link';
import { Play } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import HomeSectionHeader, { HOME_SECTION } from '@/components/HomeSectionHeader';
import { getT } from '@/lib/i18n/server';
import { listingImages } from '@/lib/listingView';
import { getCollectionTiles, getVideoListings } from '@/lib/browseFeatures';
import { COMMERCIAL_FILTER_VALUE, groupTypeFacets } from '@/lib/commercialSpaces';
import { memo } from '@/lib/memo';

/**
 * "Explorer" — the homepage's one browse section (2026-11-04 landing pass,
 * from the approved mockup). It replaces three bands that asked the same
 * question one after another: the collections, three plain link cards
 * (Combien coûte / Vidéos / Indice Lukka) and "Par type de bien".
 *
 *  - The themed collections as large photo tiles, at most four (one row on
 *    a desktop; a swipe on a phone). Each cover is a real listing's photo.
 *  - One row of chips: the busiest property types (six at most) and their real count
 *    (getPropertyTypeFacets, the hero dropdown's own source, so a chip never
 *    leads to an empty page), then "Visites en vidéo" when there are videos.
 *    Offices, shops and warehouses share one "Bureaux & commerces" chip, as
 *    the old tiles did. Names are the database's own category names.
 *
 * The price guides and the Lukka Index moved to HomeMarketBand, which shows
 * their figures instead of linking to them. Each piece renders only with
 * real data behind it; the section renders nothing when none has any.
 *
 * "Bien du jour" (item 27) was removed on 2026-11-04, owner's call; see
 * lib/browseFeatures.js getListingOfTheDay.
 */
const MAX_TILES = 4;
const MAX_CHIPS = 6;

function typeChips(propertyTypes, commercialLabel) {
  const { residential, commercial } = groupTypeFacets(propertyTypes.filter((type) => type.count > 0));
  const singles = commercial.filter((type) => !type.umbrella);
  const commercialChip = singles.length > 1
    ? { value: COMMERCIAL_FILTER_VALUE, label: commercialLabel, count: singles.reduce((sum, type) => sum + type.count, 0) }
    : singles[0] || null;
  // Six chips at most, as the type tiles had: the busiest residential types,
  // then the commercial one. Every type stays one tap away in the hero's
  // "Type de bien" select and on /listings.
  const busiest = [...residential].sort((a, b) => b.count - a.count).slice(0, commercialChip ? MAX_CHIPS - 1 : MAX_CHIPS);
  return [...busiest, commercialChip].filter(Boolean);
}

export default async function HomeDiscovery({ propertyTypes = [] }) {
  const t = await getT();
  const [tiles, videos] = await memo('home-discovery:v2', 60_000, () => Promise.all([
    getCollectionTiles(),
    getVideoListings({ limit: 3 }),
  ]));

  const shownTiles = tiles.slice(0, MAX_TILES);
  const chips = typeChips(propertyTypes, t('listings.commercial.group.commercial'));
  const showTypes = chips.length >= 2;
  if (!shownTiles.length && !showTypes && !videos.length) return null;

  return (
    <section className="bg-canvas">
      <div className={HOME_SECTION}>
        <HomeSectionHeader title={t('home.explore.title')} href="/listings" linkLabel={t('listings.empty.seeAll')} />

        {shownTiles.length ? (
          <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {shownTiles.map((tile) => {
              const cover = tile.cover ? listingImages(tile.cover)[0] : null;
              return (
                <li key={tile.slug} className="w-[64%] shrink-0 snap-start sm:w-auto">
                  <Link
                    href={`/collections/${tile.slug}`}
                    className="u-press group relative block h-56 overflow-hidden rounded-2xl bg-canvas-deep text-white sm:h-72"
                  >
                    {cover ? (
                      <SafeImage
                        src={cover}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 24rem, (min-width: 640px) 50vw, 64vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : null}
                    <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgba(11,17,32,0.78)_0%,rgba(11,17,32,0.1)_55%,rgba(11,17,32,0)_100%)]" />
                    <span className="absolute inset-x-4 bottom-4 flex flex-col gap-0.5 sm:inset-x-5">
                      <span className="text-[1.0625rem] font-bold leading-snug sm:text-[1.125rem]">{t(tile.titleKey)}</span>
                      <span className="u-tabular text-[0.8125rem] text-white/85">{t('home.types.count', { count: tile.total })}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}

        {showTypes || videos.length ? (
          <div className={shownTiles.length ? 'mt-6 sm:mt-7' : ''}>
            {showTypes ? <p className="mb-3 text-[0.8125rem] font-semibold text-ink-45">{t('home.types.title')}</p> : null}
            <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {showTypes ? chips.map(({ value, label, count }) => (
                <li key={value} className="shrink-0">
                  <Link
                    href={`/listings?property_type=${encodeURIComponent(value)}`}
                    className="u-press inline-flex min-h-11 items-center gap-2 rounded-full bg-canvas-alt px-4 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-blue-tint"
                  >
                    {label}
                    <span className="u-tabular font-normal text-ink-45">{count}</span>
                  </Link>
                </li>
              )) : null}
              {videos.length ? (
                <li className="shrink-0">
                  <Link
                    href="/videos"
                    className="u-press inline-flex min-h-11 items-center gap-2 rounded-full bg-blue-tint px-4 text-[0.875rem] font-semibold text-blue-deep transition-colors hover:bg-blue-deep hover:text-white"
                  >
                    <Play aria-hidden="true" className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                    {t('home.discovery.videos')}
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
