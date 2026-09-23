import SeoLandingPage, { seoLandingMetadata } from '@/components/seo/SeoLandingPage';

/**
 * /vente, /vente/{commune}, /vente/{type}, /vente/{type}/{commune} — search
 * landing pages (lib/seoPages.js). An unknown segment 404s.
 */
export async function generateMetadata({ params }) {
  return seoLandingMetadata('vente', params);
}

export default function Page({ params }) {
  return <SeoLandingPage transaction="vente" params={params} />;
}
