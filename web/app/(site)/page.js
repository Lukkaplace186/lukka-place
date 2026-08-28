import Hero from '@/components/Hero';
import CommuneShortcuts from '@/components/CommuneShortcuts';
import FeaturedListings from '@/components/FeaturedListings';
import ValueProposition from '@/components/ValueProposition';
import { getPropertyTypeFacets } from '@/lib/listings';

/**
 * The homepage, section for section as web/Design/Landing's "Lukka Place —
 * Landing refondue" screen defines it: hero photograph, the floating search
 * panel, the commune row (now carrying real per-commune counts),
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
 * getPropertyTypeFacets() feeds the hero's "Type de bien" select — real,
 * DB-derived options with counts, the same source FilterBar.js's own pill
 * on /listings uses, so the hero never offers a type with zero results
 * behind it. The location field sources its own suggestions from
 * /api/locations/autocomplete, so nothing needs threading through for it.
 */
export default async function HomePage() {
  const propertyTypes = await getPropertyTypeFacets();

  return (
    <>
      <Hero propertyTypes={propertyTypes} />
      <CommuneShortcuts />
      <FeaturedListings />
      <ValueProposition />
    </>
  );
}
