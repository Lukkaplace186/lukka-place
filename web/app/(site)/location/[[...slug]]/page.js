import SeoLandingPage, { seoLandingMetadata } from '@/components/seo/SeoLandingPage';

/**
 * /location, /location/{commune}, /location/{type}, /location/{type}/{commune} — search
 * landing pages (lib/seoPages.js). An unknown segment 404s, and so does a
 * ?page= past the last page.
 */
export async function generateMetadata({ params, searchParams }) {
  return seoLandingMetadata('location', params, searchParams);
}

export default function Page({ params, searchParams }) {
  return <SeoLandingPage transaction="location" params={params} searchParams={searchParams} />;
}
