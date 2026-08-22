import Hero from '@/components/Hero';
import FeaturedListings from '@/components/FeaturedListings';
import ExploreCommunes from '@/components/ExploreCommunes';
import TransactionTypesGrid from '@/components/TransactionTypesGrid';
import CurrencyBridge from '@/components/CurrencyBridge';
import ValueProposition from '@/components/ValueProposition';
import TrustSection from '@/components/TrustSection';
import { getCommuneShowcase } from '@/lib/listings';

/**
 * The homepage is the emotive surface — airy spacing, real photography, one
 * idea per section. /listings is the dense counterpart.
 *
 * getCommuneShowcase() feeds the commune tiles below. The hero's own search
 * (LocationAutocomplete) sources its suggestions independently, from
 * /api/locations/autocomplete — it no longer needs this data threaded
 * through as a prop.
 */
export default async function HomePage() {
  const communes = await getCommuneShowcase(6);

  return (
    <>
      <Hero />
      <FeaturedListings />
      <ExploreCommunes communes={communes} />
      <TransactionTypesGrid />
      <CurrencyBridge />
      <ValueProposition />
      <TrustSection />
    </>
  );
}
