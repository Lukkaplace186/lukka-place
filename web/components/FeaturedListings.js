import FeaturedListingsCarousel from './FeaturedListingsCarousel';
import SectionHeading from './SectionHeading';
import { getListings } from '@/lib/listings';
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
  const { data, count } = await getListings({ limit: 8 });

  if (count === 0) return null;

  return (
    <section className="mx-auto max-w-[1600px] px-4 pt-8 pb-14 sm:px-6 sm:pt-14 sm:pb-24 lg:px-8">
      {/* No `lead`. It read "Les annonces les plus récemment vérifiées et
          mises en ligne." directly under a title and an eyebrow that both
          already said as much — the same claim three times in one header
          block, and on mobile that third line pushed the first real listing
          two rows further down. The eyebrow carries the recency framing, the
          title names the section.

          The eyebrow was also the last hardcoded French string on this page:
          an English visitor read "Sélection de la semaine" above an English
          title. It resolves through the dictionary like everything else now. */}
      <SectionHeading
        eyebrow={t('home.featuredEyebrow')}
        title={t('home.featuredHeading')}
        href="/listings"
        linkLabel={t('listings.empty.seeAll')}
        className="mb-6 sm:mb-10"
      />
      <FeaturedListingsCarousel listings={data} />
    </section>
  );
}
