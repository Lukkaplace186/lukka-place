import { SITE_URL } from '@/lib/constants';
import { getSitemapListings, getCommuneShowcase } from '@/lib/listings';

/**
 * /sitemap.xml — every public listing, the communes that have listings, and
 * the static pages. Regenerated at most hourly: a listing approved this
 * morning should reach search engines today, but this is not worth a query
 * per crawler hit.
 */
export const revalidate = 3600;

export default async function sitemap() {
  const base = SITE_URL.replace(/\/+$/, '');
  const now = new Date();
  const pages = ['', '/listings', '/agents', '/a-propos', '/contact'].map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === '' || path === '/listings' ? 'daily' : 'monthly',
    priority: path === '' ? 1 : 0.7,
  }));

  // A sitemap that fails to build must still list the pages it can.
  const [listings, communes] = await Promise.all([
    getSitemapListings().catch((err) => {
      console.error('[sitemap] listings unavailable', err);
      return [];
    }),
    getCommuneShowcase(24).catch(() => []),
  ]);

  return [
    ...pages,
    ...communes.map(({ commune }) => ({
      url: `${base}/listings?commune=${encodeURIComponent(commune)}`,
      lastModified: now,
      changeFrequency: 'daily',
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
