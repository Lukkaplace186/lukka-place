import FeaturedListingsCarousel from './FeaturedListingsCarousel';
import HomeSectionHeader, { HOME_SECTION } from './HomeSectionHeader';
import { cachedFeaturedListings } from '@/lib/listingsCached';
import { getT } from '@/lib/i18n/server';

/**
 * The most recent approved listings — real data behind the same
 * status=1/approve_status=1 gate as every other read (lib/listings.js),
 * never curated or placeholder entries. Renders nothing at all when there
 * are no approved listings rather than showing an empty shell.
 *
 * Eight, not six: the refonte's grid is four across at desktop, and its own
 * layout rule caps this at "eight cards above the fold at most" — two full
 * rows, then pagination on /listings rather than more here.
 */
export default async function FeaturedListings() {
  const t = await getT();
  // A 60-second copy: the same eight cards for every visitor in that minute.
  const { data, count } = await cachedFeaturedListings();

  if (count === 0) return null;

  return (
    /* Prestige white, on an explicit product decision — a warm sand band
       was tried here and rejected. The outer/inner split is kept from that
       attempt: the fill is the full-bleed element and the max-width
       container sits inside it, so a future ground or rule reaches both
       edges of the screen rather than stopping at the 1600px gutter. */
    <section className="bg-canvas">
      <div className={HOME_SECTION}>
        {/* The homepage's one section header (HomeSectionHeader): title and a
            sentence-case link, no eyebrow — 2026-11-04 landing pass. */}
        <HomeSectionHeader title={t('home.featuredHeading')} href="/listings" linkLabel={t('listings.empty.seeAll')} />
        <FeaturedListingsCarousel listings={data} />
      </div>
    </section>
  );
}
