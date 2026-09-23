import SeoLandingPage, { seoLandingMetadata } from '@/components/seo/SeoLandingPage';

/**
 * /location, /location/{commune}, /location/{type}, /location/{type}/{commune} — search
 * landing pages (lib/seoPages.js). An unknown segment 404s.
 */
export async function generateMetadata({ params }) {
  return seoLandingMetadata('location', params);
}

export default function Page({ params }) {
  return <SeoLandingPage transaction="location" params={params} />;
}
