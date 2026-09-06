import PropertyCard from './PropertyCard';
import SectionHeading from './SectionHeading';
import { getT } from '@/lib/i18n/server';

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
 *
 * `mode: 'similar'` is set by the caller when the rail was actually filled
 * by lib/listings.js's getSimilarListings() (real pgvector cosine distance
 * against the listing's own stored embedding) rather than the commune/
 * citywide fallback — labelled honestly as "Biens similaires" rather than
 * implied to be a location match, since a semantically similar listing can
 * easily sit in a different commune.
 */
// Async and server-side: this renders from the listing detail page, itself a
// Server Component, and has no state, effects or handlers of its own. It
// briefly called useT() without a 'use client' directive, which is a
// request-time "t is not defined"/client-reference throw rather than a build
// error — /listings/[id] is dynamic, so `next build` never executes it.
export default async function RelatedListings({ listings, commune, widened = false, mode = 'commune' }) {
  const t = await getT();
  if (!listings || listings.length === 0) return null;

  const title =
    mode === 'similar'
      ? t('listings.related.similar')
      : widened || !commune
        ? t('listings.related.otherInKinshasa')
        : t('listings.related.otherIn', { commune });
  const eyebrow = mode === 'similar' ? t('listings.related.recommended') : t('listings.related.nearby');
  const lead = widened && commune ? t('listings.related.noneLeftIn', { commune }) : undefined;

  return (
    <section className="border-t border-line bg-canvas-alt py-16">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow={eyebrow} title={title} lead={lead} href="/listings" className="mb-8" />
        {/* Each card needs an explicit width here: a plain flex row gives
            an unconstrained child no size of its own to scroll with, so
            every PropertyCard (layout="vertical", the default — its root
            @container div carries no width class, unlike the "horizontal"
            layout other call sites use) collapsed to near-zero width and
            the whole rail rendered as blank space. Confirmed directly: a
            live width probe on this exact row measured every card at 0px.
            w-[19rem] shrink-0 gives each card the fixed rail-item width it
            needs; snap-start (missing before) is what the row's own
            snap-x/snap-mandatory was already set up to use per card. */}
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
          {listings.map((listing) => (
            <div key={listing.id} className="w-[19rem] shrink-0 snap-start">
              <PropertyCard listing={listing} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
