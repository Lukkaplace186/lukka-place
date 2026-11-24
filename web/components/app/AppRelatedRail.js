'use client';

import AppRailCard from './AppRailCard';

/**
 * "Biens similaires" at the foot of a listing in the app: the same rail of
 * large photos as the home screen, so the page ends on homes. The listings
 * and the title come from the page's own similarity query and its fallbacks
 * (app/(site)/listings/[id]/page.js, RelatedSection); nothing here chooses.
 */
export default function AppRelatedRail({ title, lead = null, listings = [] }) {
  if (!listings.length) return null;
  return (
    <section className="mt-10 border-t border-line pt-7">
      <h2 className="px-4 text-[1.0625rem] font-bold text-ink">{title}</h2>
      {lead ? <p className="mt-1 px-4 text-[0.8125rem] text-ink-45">{lead}</p> : null}
      <div className="no-scrollbar mt-3 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
        {listings.map((listing) => (
          <AppRailCard key={listing.id} listing={listing} />
        ))}
      </div>
    </section>
  );
}
