import Link from '@/components/LocaleLink';
import { ArrowRight } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { cachedSeoFacets } from '@/lib/listingsCached';
import { cachedPriceGuides, priceGuideSlug, priceQuestion } from '@/lib/browseFeatures';
import { communeLabel } from '@/lib/cities';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { frNumber } from '@/lib/format';
import { landingPathsFromFacets, parseSeoSegments, seoPath } from '@/lib/seoPages';
import { landingHeadingFor } from '@/components/seo/SeoLandingPage';

const TRANSACTION_OF_PURPOSE = { rent: 'location', sale: 'vente' };

/**
 * "Explorer" links at the foot of a listing page (SEO plan 2026-11-26): the
 * commune × type page, the commune page and the matching price page. A
 * listing used to link only to its commune (breadcrumb), so Google reached
 * the commune × type and price pages from the home page alone, and had
 * never seen half of them.
 *
 * Every link is to a page that exists and is indexed: a landing path from
 * landingPathsFromFacets (the sitemap's own rule, ≥ 3 listings for a type in
 * a commune) and a price guide that getPriceGuides publishes. Nothing renders
 * when none applies; a failed read renders nothing.
 */
export default async function ListingExploreLinks({ listing }) {
  const transaction = TRANSACTION_OF_PURPOSE[listing.purpose];
  if (!transaction || !listing.commune) return null;
  const [facets, guides, t] = await Promise.all([
    cachedSeoFacets().catch(() => []),
    transaction === 'location' ? cachedPriceGuides().catch(() => []) : Promise.resolve([]),
    getT(),
  ]);
  const live = new Set(landingPathsFromFacets(facets));
  const links = [];
  const addLanding = (args) => {
    const path = seoPath(args);
    if (!path || !live.has(path)) return;
    const page = parseSeoSegments(transaction, path.split('/').slice(2));
    if (!page) return;
    links.push({ href: path, label: landingHeadingFor(page, t, facets) });
  };
  // getSeoFacets counts LOWER(category name), the same value as here.
  const type = String(listing.category_name || '').toLowerCase() || null;
  if (type) addLanding({ transaction, propertyType: type, commune: listing.commune });
  addLanding({ transaction, commune: listing.commune });

  const beds = Number(listing.beds);
  if (transaction === 'location' && Number.isInteger(beds) && beds > 0) {
    const slug = priceGuideSlug({ beds, commune: listing.commune });
    const guide = guides.find((g) => g.slug === slug);
    if (guide) {
      links.push({
        href: `/combien-coute/${guide.slug}`,
        label: priceQuestion(t, { beds: guide.beds, commune: communeLabel(guide.commune) }),
        note: `${frNumber(guide.median)} $ ${t('home.prices.perMonth')}`,
      });
    }
  }
  if (transaction === 'location' && guides.length > 0) {
    links.push({ href: '/combien-coute', label: t('home.prices.indexTitle', { year: new Date().getUTCFullYear() }) });
  }
  if (links.length === 0) return null;

  return (
    <nav aria-labelledby="explore-heading" className="mx-auto mt-10 w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">
      <h2 id="explore-heading" className="u-title-card text-ink">{t('listings.explore.title', { commune: communeLabel(listing.commune) })}</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {links.map(({ href, label, note }) => (
          <li key={href}>
            <Link href={href} className="u-press flex h-full min-h-11 items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-ink hover:border-ink-25">
              <span className="flex min-w-0 flex-col">
                <span className="text-[0.9375rem] font-semibold">{label}</span>
                {note ? <span className="u-micro u-tabular text-ink-45">{note}</span> : null}
              </span>
              <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
