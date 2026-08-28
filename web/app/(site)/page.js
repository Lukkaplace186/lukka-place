import Hero from '@/components/Hero';
import CommuneShortcuts from '@/components/CommuneShortcuts';
import FeaturedListings from '@/components/FeaturedListings';
import ValueProposition from '@/components/ValueProposition';
import { getPropertyTypeFacets } from '@/lib/listings';

/**
 * The homepage, section for section as web/Design's "Accueil — desktop"
 * screen defines it: hero photograph, the floating search panel, the
 * commune row, "Nouveautés vérifiées à Kinshasa", and the "Notre approche"
 * band — which is where the page ends, straight into the footer.
 *
 * Four sections were removed to get here, because the design carries none
 * of them: ExploreCommunes ("Explorez par commune" / Quartiers),
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
