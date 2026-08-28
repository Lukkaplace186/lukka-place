import FeaturedListingsCarousel from './FeaturedListingsCarousel';
import SectionHeading from './SectionHeading';
import { getListings } from '@/lib/listings';

/**
 * The most recent approved listings — real data behind the same
 * status=1/approve_status=1 gate as every other read (lib/listings.js),
 * never curated or placeholder entries. Renders nothing at all when there
 * are no approved listings rather than showing an empty shell.
 */
export default async function FeaturedListings() {
  const { data, count } = await getListings({ limit: 6 });

  if (count === 0) return null;

  return (
    <section className="mx-auto max-w-[1600px] px-4 pt-10 pb-20 sm:px-6 sm:pt-14 sm:pb-28 lg:px-8">
      <SectionHeading
        eyebrow="Sélection de la semaine"
        title="Nouveautés vérifiées à Kinshasa"
        lead="Les annonces les plus récemment vérifiées et mises en ligne."
        href="/listings"
        linkLabel="Voir les annonces"
        className="mb-10"
      />
      <FeaturedListingsCarousel listings={data} />
    </section>
  );
}
