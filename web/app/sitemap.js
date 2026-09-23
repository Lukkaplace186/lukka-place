import { SITE_URL } from '@/lib/constants';
import { getSitemapListings, getSeoFacets } from '@/lib/listings';
import { GUIDES } from '@/lib/guides';
import { landingPathsFromFacets } from '@/lib/seoPages';

/**
 * /sitemap.xml — every public listing, the search landing pages that have
 * listings (lib/seoPages.js — never an empty one), the guides and the static
 * pages. Regenerated at most hourly: a listing approved this morning should
 * reach search engines today, but this is not worth a query per crawler hit.
 */
export const revalidate = 3600;

export default async function sitemap() {
  const base = SITE_URL.replace(/\/+$/, '');
  const now = new Date();
  const pages = ['', '/listings', '/agents', '/guides', '/a-propos', '/contact'].map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === '' || path === '/listings' ? 'daily' : 'monthly',
    priority: path === '' ? 1 : 0.7,
  }));

  // A sitemap that fails to build must still list the pages it can.
  const [listings, facets] = await Promise.all([
    getSitemapListings().catch((err) => {
      console.error('[sitemap] listings unavailable', err);
      return [];
    }),
    getSeoFacets().catch((err) => {
      console.error('[sitemap] landing facets unavailable', err);
      return [];
    }),
  ]);

  return [
    ...pages,
    ...landingPathsFromFacets(facets).map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: 'daily',
      // The two city-wide roots and commune pages are what people search for.
      priority: path.split('/').length <= 3 ? 0.8 : 0.7,
    })),
    ...GUIDES.map((g) => ({
      url: `${base}/guides/${g.slug}`,
      lastModified: new Date(g.updated),
      changeFrequency: 'monthly',
      priority: 0.6,
    })),
    ...listings.map(({ id, updatedAt }) => ({
      url: `${base}/listings/${id}`,
      lastModified: Number.isNaN(updatedAt.getTime()) ? now : updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8,
    })),
  ];
}
