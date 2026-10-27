import Link from 'next/link';
import { ChevronRight, Film, LineChart, Sparkles, Tag } from 'lucide-react';
import PropertyCard from '@/components/PropertyCard';
import SafeImage from '@/components/SafeImage';
import { getT } from '@/lib/i18n/server';
import { listingImages } from '@/lib/listingView';
import { getCollectionTiles, getListingOfTheDay, getPriceGuides, getVideoListings, getLukkaIndex } from '@/lib/browseFeatures';
import { memo } from '@/lib/memo';

/**
 * Reasons to browse when nobody is looking for a place yet (growth plan items
 * 27–31), on the homepage: the listing of the day, the themed collections,
 * and links to the price guides, the video feed and the Lukka Index — each
 * shown only when it has something real behind it. One 60-second in-process
 * copy (lib/memo.js), like the homepage's other counts: these are a handful
 * of aggregate reads, not search results.
 */
export default async function HomeDiscovery() {
  const t = await getT();
  const [daily, tiles, guides, videos, index] = await memo('home-discovery', 60_000, () => Promise.all([
    getListingOfTheDay(),
    getCollectionTiles(),
    getPriceGuides(),
    getVideoListings({ limit: 3 }),
    getLukkaIndex(),
  ]));

  const links = [
    guides.length ? { href: '/combien-coute', icon: Tag, label: t('home.discovery.prices'), hint: t('home.discovery.pricesHint', { count: guides.length }) } : null,
    videos.length ? { href: '/videos', icon: Film, label: t('home.discovery.videos'), hint: t('home.discovery.videosHint') } : null,
    index?.communes?.length ? { href: '/indice-lukka', icon: LineChart, label: t('home.discovery.index'), hint: t('home.discovery.indexHint') } : null,
  ].filter(Boolean);

  if (!daily && !tiles.length && !links.length) return null;

  return (
    <section className="bg-canvas pb-8 pt-2 sm:pb-12">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-4 sm:px-6 lg:px-8">
        {daily ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-center">
            <div>
              <p className="u-eyebrow inline-flex items-center gap-1.5 text-blue-deep">
                <Sparkles strokeWidth={1.75} className="h-4 w-4" aria-hidden="true" />
                {t('home.daily.eyebrow')}
              </p>
              <h2 className="u-title-storefront mt-1 text-ink">{t('home.daily.title')}</h2>
              <p className="u-body mt-2 text-ink-70">{t('home.daily.lead')}</p>
              <Link href="/bien-du-jour" className="u-micro-strong mt-3 inline-flex items-center gap-1 text-blue-deep hover:underline">
                {t('home.daily.share')}
                <ChevronRight strokeWidth={1.75} className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="max-w-md">
              <PropertyCard listing={daily.listing} />
            </div>
          </div>
        ) : null}

        {tiles.length ? (
          <div>
            <h2 className="u-title-storefront mb-4 text-ink">{t('home.collections.title')}</h2>
            <ul className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] sm:overflow-visible sm:px-0">
              {tiles.map((tile) => {
                const cover = tile.cover ? listingImages(tile.cover)[0] : null;
                return (
                  <li key={tile.slug} className="w-44 shrink-0 snap-start sm:w-auto">
                    <Link href={`/collections/${tile.slug}`} className="u-press group block overflow-hidden rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]">
                      <div className="relative aspect-[4/3] bg-canvas-alt">
                        {cover ? <SafeImage src={cover} alt="" fill sizes="(min-width: 640px) 16rem, 11rem" className="object-cover" /> : null}
                      </div>
                      <div className="p-3">
                        <span className="block text-[0.875rem] font-bold text-ink">{t(tile.titleKey)}</span>
                        <span className="u-tabular block text-[0.75rem] text-ink-45">{t('home.types.count', { count: tile.total })}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {links.length ? (
          <ul className="grid gap-3 sm:grid-cols-3">
            {links.map(({ href, icon: Icon, label, hint }) => (
              <li key={href}>
                <Link href={href} className="u-press flex h-full items-center gap-3 rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)]">
                  <Icon strokeWidth={1.5} className="h-6 w-6 shrink-0 text-blue" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] font-bold text-ink">{label}</span>
                    <span className="block text-[0.8125rem] text-ink-45">{hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
