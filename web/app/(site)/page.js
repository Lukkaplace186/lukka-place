import Hero from '@/components/Hero';
import FeaturedListings from '@/components/FeaturedListings';
import ValueProposition from '@/components/ValueProposition';
import { getListings, getPopularCommunes, getPropertyTypeFacets } from '@/lib/listings';

/**
 * The homepage, section for section as web/Design/Landing's "Lukka Place —
 * Landing refondue" screen defines it: hero photograph, the floating search
 * panel (which now carries the commune row, with real per-commune counts,
 * as its own bottom tier),
 * "Nouveautés vérifiées à Kinshasa" as two rows of four, and the "Notre
 * approche" band — which is where the page ends, into the footer and its
 * agency band.
 *
 * The refonte's three-item proof row ("Chaque annonce contrôlée par un
 * humain avant publication" / "Une seule ligne WhatsApp..." / "Prix
 * affichés tels quels...") is deliberately NOT built: it was cut on the
 * client's own instruction. The mockup puts it directly under the search
 * panel, in the gap left by the royal seller strip that moved down to the
 * footer band; nothing replaces it, the commune row simply follows the
 * panel. All three claims are still made — at length, and in the section
 * that exists to make them — by ValueProposition below.
 *
 * Four sections were removed earlier, because the design carries none of
 * them: ExploreCommunes ("Explorez par commune" / Quartiers),
 * TransactionTypesGrid, CurrencyBridge, and TrustSection ("Qui est
 * derrière" / "Une seule équipe, un seul numéro"). The components still
 * exist and nothing else imports them — they are simply off the homepage.
 *
 * Three real, DB-derived values are threaded into the hero, none of them
 * decorative:
 *   - getPropertyTypeFacets() feeds the "Type de bien" select — options
 *     with real counts, the same source FilterBar.js's own pill on
 *     /listings uses, so the hero never offers a type with zero results.
 *   - getPopularCommunes() feeds the panel's own commune quick-pills.
 *   - getListings({ limit: 1 }).total is the real approved-listing total
 *     behind the "Rechercher (N biens)" CTA on first paint. `limit: 1`
 *     keeps the row payload minimal; the COUNT query getListings() runs
 *     internally is unaffected by limit. From there the panel refetches
 *     /api/listings/count as filters change — same endpoint, same query.
 * The location field sources its own suggestions from
 * /api/locations/autocomplete, so nothing needs threading through for it.
 *
 * CommuneShortcuts is no longer rendered here. It was a row of commune
 * pills sitting immediately under the search panel; the panel now carries
 * that row itself, where a tap FILLS the search field instead of navigating
 * straight to /listings — which is the more useful of the two, since it
 * composes with the transaction/type/budget already staged above it rather
 * than discarding them. Two visually identical commune rows stacked on top
 * of each other was the alternative. The component still exists and nothing
 * else imports it, same as the four other sections listed above.
 */
export default async function HomePage() {
  const [propertyTypes, communes, { total }] = await Promise.all([
    getPropertyTypeFacets(),
    getPopularCommunes(8),
    getListings({ limit: 1 }),
  ]);

  return (
    <>
      <Hero propertyTypes={propertyTypes} communes={communes} initialCount={total} />
      <FeaturedListings />
      <ValueProposition />
    </>
  );
}
