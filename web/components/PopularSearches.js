import Link from '@/components/IntentLink';
import { getT } from '@/lib/i18n/server';
import { cachedSeoFacets } from '@/lib/listingsCached';
import { SEO_PROPERTY_TYPES, SEO_TRANSACTIONS, popularSearchLinks, typeSlugFor } from '@/lib/seoPages';

/**
 * "Recherches populaires" — the homepage's links to the search landing pages
 * (owner, 2026-11-19: as many links to our pages as Google will follow).
 * Server-rendered plain links, so a crawler follows them without JavaScript,
 * and each says what its page is about ("Appartements à louer à Gombe"), the
 * landing page's own heading (seo.heading). Only pages with listings right
 * now (lib/seoPages.js popularSearchLinks), each with its real count; Goma is
 * left out on the owner's request. Nothing renders when there are no listings.
 */
export const POPULAR_SEARCHES_EXCLUDED_CITIES = ['Goma'];

export default async function PopularSearches() {
  const facets = await cachedSeoFacets().catch(() => []);
  const links = popularSearchLinks(facets, { excludeCities: POPULAR_SEARCHES_EXCLUDED_CITIES });
  if (links.length === 0) return null;
  const t = await getT();
  const label = ({ transaction, propertyType, commune, city }) => {
    const slug = propertyType ? typeSlugFor(propertyType) : null;
    const type = slug ? t(SEO_PROPERTY_TYPES[slug].pluralKey) : t('seo.allTypes');
    const place = commune ? (commune === 'Kinshasa' ? t('seo.communeKinshasa') : commune) : city || t('seo.city');
    return t('seo.heading', { type, transaction: t(SEO_TRANSACTIONS[transaction].labelKey), place });
  };

  return (
    <section aria-labelledby="popular-searches-title" className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6 lg:px-8">
      <h2 id="popular-searches-title" className="u-title-section mb-4">
        {t('home.popularSearches.title')}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[0.8125rem] font-medium text-ink transition-colors hover:border-blue hover:text-blue-deep"
            >
              {label(link)}
              <span className="u-tabular text-ink-45">{link.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
