import FeaturedListingCard from './FeaturedListingCard';
import SectionHeading from './SectionHeading';

/**
 * "Other properties nearby" rail.
 *
 * The detail page was previously a dead end — a visitor who did not want
 * this particular property had nowhere to go but the back button, which is
 * the single clearest way a property site loses someone. Everything here is
 * a real approved listing from the same commune, self excluded via
 * buildFilters' `excludeId`.
 *
 * `widened` is set by the caller when the commune-scoped query came back
 * empty and the search fell back to the whole city. It is surfaced in the
 * copy rather than hidden, so the rail never implies these are in the same
 * commune when they are not — the same honesty the buyer-assistant's
 * property matching applies to a widened search.
 */
export default function RelatedListings({ listings, commune, widened = false }) {
  if (!listings || listings.length === 0) return null;

  const title = widened || !commune ? 'Autres biens à Kinshasa' : `Autres biens à ${commune}`;
  const lead = widened && commune ? `Aucun autre bien disponible à ${commune} pour le moment.` : undefined;

  return (
    <section className="border-t border-line bg-canvas-alt py-16">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="À proximité" title={title} lead={lead} href="/listings" className="mb-8" />
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
          {listings.map((listing) => (
            <FeaturedListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </div>
    </section>
  );
}
