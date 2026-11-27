import SeoLandingPage, { seoLandingMetadata } from '@/components/seo/SeoLandingPage';

/**
 * /vente, /vente/{commune}, /vente/{type}, /vente/{type}/{commune} — search
 * landing pages (lib/seoPages.js). An unknown segment 404s, and so does a
 * ?page= past the last page.
 */
export async function generateMetadata({ params, searchParams }) {
  return seoLandingMetadata('vente', params, searchParams);
}

export default function Page({ params, searchParams }) {
  return <SeoLandingPage transaction="vente" params={params} searchParams={searchParams} />;
}
