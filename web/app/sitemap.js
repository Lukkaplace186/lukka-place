import { SITE_URL } from '@/lib/constants';
import { getSitemapListings, getSeoFacets } from '@/lib/listings';
import { GUIDES } from '@/lib/guides';
import { landingPathsFromFacets } from '@/lib/seoPages';
import { getSitemapProjects } from '@/lib/developments';
import { getFeatureFlags } from '@/lib/siteSettings';
import { getCollectionTiles, getLukkaIndex, getPriceGuides } from '@/lib/browseFeatures';
import { listPublicPostSlugs } from '@/lib/blog';

const PROJECT_PAGES = ['/projets', '/promoteurs'];

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
  // Projets neufs switched off on /admin/settings: none of its pages are listed.
  const { publicProjects, publicBlog } = await getFeatureFlags();
  const pages = ['', '/listings', '/projets', '/promoteurs', '/agents', '/guides', '/a-propos', '/contact']
    .filter((path) => publicProjects || !PROJECT_PAGES.includes(path))
    .map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === '' || path === '/listings' ? 'daily' : 'monthly',
    priority: path === '' ? 1 : 0.7,
  }));

  // A sitemap that fails to build must still list the pages it can.
  const [listings, facets, projects, posts, priceGuides, collections, lukkaIndex] = await Promise.all([
    getSitemapListings().catch((err) => {
      console.error('[sitemap] listings unavailable', err);
      return [];
    }),
    getSeoFacets().catch((err) => {
      console.error('[sitemap] landing facets unavailable', err);
      return [];
    }),
    (publicProjects ? getSitemapProjects() : Promise.resolve([])).catch((err) => {
      console.error('[sitemap] projects unavailable', err);
      return [];
    }),
    // Guides & Actualités posts only while the blog is on (never throws).
    publicBlog ? listPublicPostSlugs() : Promise.resolve([]),
    // Growth plan items 27–31: only pages that exist (enough data behind them).
    getPriceGuides(),
    getCollectionTiles(),
    getLukkaIndex(),
  ]);
  const guideSlugs = new Set(GUIDES.map((g) => g.slug));
  const discovery = [
    '/bien-du-jour', '/confidentialite',
    ...(priceGuides.length ? ['/combien-coute', ...priceGuides.map((guide) => `/combien-coute/${guide.slug}`)] : []),
    ...collections.map((tile) => `/collections/${tile.slug}`),
    ...(lukkaIndex?.communes?.length ? ['/indice-lukka'] : []),
  ];

  return [
    ...pages,
    ...discovery.map((path) => ({ url: `${base}${path}`, lastModified: now, changeFrequency: 'daily', priority: 0.6 })),
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
    // A post with a guide's slug replaces that guide: one URL, listed once.
    ...posts.filter(({ slug }) => !guideSlugs.has(slug)).map(({ slug, updated_at: updatedAt }) => ({
      url: `${base}/guides/${slug}`,
      lastModified: updatedAt ? new Date(updatedAt) : now,
      changeFrequency: 'monthly',
      priority: 0.6,
    })),
    ...projects.map(({ slug, updated_at: updatedAt }) => ({
      url: `${base}/projets/${slug}`,
      lastModified: updatedAt ? new Date(updatedAt) : now,
      changeFrequency: 'weekly',
      priority: 0.8,
    })),
    ...listings.map(({ id, updatedAt }) => ({
      url: `${base}/listings/${id}`,
      lastModified: Number.isNaN(updatedAt.getTime()) ? now : updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8,
    })),
  ];
}
