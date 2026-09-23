import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import PropertyCard from '@/components/PropertyCard';
import JsonLd from '@/components/seo/JsonLd';
import { getListings, getListingStats } from '@/lib/listings';
import { cachedSeoFacets } from '@/lib/listingsCached';
import { getT } from '@/lib/i18n/server';
import { formatPrice } from '@/lib/format';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { distanceKm } from '@/lib/mapViewport';
import { GUIDES } from '@/lib/guides';
import {
  SEO_PROPERTY_TYPES,
  SEO_TRANSACTIONS,
  listingsHrefFor,
  parseSeoSegments,
  seoPath,
  typeSlugFor,
} from '@/lib/seoPages';

/** A median drawn from fewer listings than this is not shown — same floor as the market benchmarks. */
const MIN_MEDIAN_SAMPLE = 5;
const PAGE_LISTINGS = 24;

const base = SITE_URL.replace(/\/+$/, '');

function labels(page, t) {
  const type = page.typeSlug ? t(SEO_PROPERTY_TYPES[page.typeSlug].pluralKey) : t('seo.allTypes');
  const transaction = t(SEO_TRANSACTIONS[page.transaction].labelKey);
  const place = page.commune ? (page.commune === 'Kinshasa' ? t('seo.communeKinshasa') : page.commune) : t('seo.city');
  const heading = t('seo.heading', { type, transaction, place });
  const lowerType = type.charAt(0).toLowerCase() + type.slice(1);
  const headingLower = t('seo.headingLower', { type: lowerType, transaction, place });
  return { type, transaction, place, heading, headingLower };
}

/**
 * One set of reads per request: generateMetadata and the page both call this
 * with the same key, and React's per-request cache runs it once.
 */
const loadPage = cache(async (transaction, slugKey) => {
  const page = parseSeoSegments(transaction, slugKey ? slugKey.split('/') : []);
  if (!page) return null;
  const filters = { transactionType: page.transactionType, propertyType: page.propertyType, commune: page.commune };
  const [stats, results, facets] = await Promise.all([
    getListingStats(filters),
    getListings({ ...filters, limit: PAGE_LISTINGS, sort: 'complete' }),
    cachedSeoFacets().catch(() => []),
  ]);
  return { page, filters, stats, listings: results.data, facets };
});

async function slugKeyOf(params) {
  const { slug } = await params;
  return (slug || []).join('/');
}

export async function seoLandingMetadata(transaction, params) {
  const data = await loadPage(transaction, await slugKeyOf(params));
  if (!data) return {};
  const { page } = data;
  const { total } = data.stats;
  const t = await getT();
  const { heading } = labels(page, t);
  const path = seoPath(page);
  const description = total > 0
    ? t('seo.metaDescription', { count: total, heading })
    : t('seo.metaDescriptionNone', { heading });
  return {
    title: t('seo.metaTitle', { heading }),
    description,
    alternates: { canonical: path },
    // An empty page is thin content: kept out of the index until a listing
    // lands, still followed so its links count.
    robots: total > 0 ? undefined : { index: false, follow: true },
    openGraph: { title: heading, description, url: path, type: 'website' },
  };
}

/** Group facet rows by one key, summing counts. */
function sumBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!k) continue;
    out.set(k, (out.get(k) || 0) + row.count);
  }
  return [...out.entries()].map(([value, count]) => ({ value, count }));
}

function LinkList({ title, links }) {
  if (!links.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="u-h2 text-ink">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {links.map(({ href, label, count }) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-ink-25 hover:text-ink"
            >
              {label}
              {count != null ? <span className="text-ink-35">{count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4">
      <dt className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-ink-45">{label}</dt>
      <dd className="u-tabular text-lg font-semibold text-ink">{value}</dd>
      {note ? <dd className="text-xs text-ink-45">{note}</dd> : null}
    </div>
  );
}

export default async function SeoLandingPage({ transaction, params }) {
  const data = await loadPage(transaction, await slugKeyOf(params));
  if (!data) notFound();

  const { page, filters, stats, listings, facets } = data;
  const t = await getT();
  const { type, transaction: txLabel, place, heading, headingLower } = labels(page, t);
  const path = seoPath(page);
  const purpose = page.purpose;
  const price = (v) => formatPrice(v, purpose, null);

  // ---- link graph, from real counts only (never a link to an empty page) ----
  // Parcelle rows are a second axis over the same listings (a parcelle is also
  // a Maison or a Terrain), so they are left out of any all-types total.
  const matchesType = (f, propertyType) => (propertyType ? f.propertyType === propertyType : f.propertyType !== 'parcelle');
  const samePurpose = facets.filter((f) => f.purpose === purpose);
  const sameType = samePurpose.filter((f) => matchesType(f, page.propertyType));

  const communeCounts = sumBy(sameType, 'commune').filter((c) => c.value !== page.commune);
  let otherCommunes;
  if (stats.total === 0 && page.commune && KINSHASA_COMMUNE_CENTROIDS[page.commune]) {
    const origin = KINSHASA_COMMUNE_CENTROIDS[page.commune];
    otherCommunes = communeCounts
      .filter((c) => KINSHASA_COMMUNE_CENTROIDS[c.value])
      .sort((a, b) => distanceKm(origin, KINSHASA_COMMUNE_CENTROIDS[a.value]) - distanceKm(origin, KINSHASA_COMMUNE_CENTROIDS[b.value]))
      .slice(0, 8);
  } else {
    otherCommunes = communeCounts.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  const communeLinks = otherCommunes
    .map((c) => ({ href: seoPath({ transaction, propertyType: page.propertyType, commune: c.value }), label: c.value === 'Kinshasa' ? t('seo.communeKinshasa') : c.value, count: c.count }))
    .filter((l) => l.href);

  const inPlace = page.commune ? samePurpose.filter((f) => f.commune === page.commune) : samePurpose;
  const typeLinks = sumBy(inPlace, 'propertyType')
    .filter((f) => f.value !== page.propertyType && typeSlugFor(f.value))
    .sort((a, b) => b.count - a.count)
    .map((f) => ({
      href: seoPath({ transaction, propertyType: f.value, commune: page.commune }),
      label: t(SEO_PROPERTY_TYPES[typeSlugFor(f.value)].pluralKey),
      count: f.count,
    }));
  if (page.propertyType) {
    typeLinks.unshift({ href: seoPath({ transaction, commune: page.commune }), label: t('seo.allTypes') });
  }

  const otherTransaction = transaction === 'location' ? 'vente' : 'location';
  const otherPurpose = SEO_TRANSACTIONS[otherTransaction].purpose;
  const otherCount = facets
    .filter((f) => f.purpose === otherPurpose && (!page.commune || f.commune === page.commune) && matchesType(f, page.propertyType))
    .reduce((sum, f) => sum + f.count, 0);
  const seeAlso = otherCount > 0
    ? [{
        href: seoPath({ transaction: otherTransaction, propertyType: page.propertyType, commune: page.commune }),
        label: t('seo.heading', { type, transaction: t(SEO_TRANSACTIONS[otherTransaction].labelKey), place }),
        count: otherCount,
      }]
    : [];

  // ---- figures ----
  const showMedian = Boolean(page.propertyType) && stats.pricedCount >= MIN_MEDIAN_SAMPLE && stats.priceMedian != null;
  const showRange = stats.pricedCount >= 2 && stats.priceMin != null && stats.priceMin !== stats.priceMax;
  const depositMonths = stats.depositMedian != null ? Math.round(stats.depositMedian * 10) / 10 : null;

  // ---- FAQ: every answer is either a figure from the page's own listings or
  // a true description of how the site works ----
  const faq = [];
  if (stats.pricedCount >= 1 && stats.priceMin != null) {
    const answer = showRange
      ? [t('seo.faqPriceA', { min: price(stats.priceMin), max: price(stats.priceMax) }),
         showMedian ? t('seo.faqPriceMedian', { median: price(stats.priceMedian), count: stats.pricedCount }) : null]
          .filter(Boolean).join(' ')
      : t('seo.faqPriceSingle', { min: price(stats.priceMin) });
    faq.push({ q: t('seo.faqPriceQ', { headingLower }), a: answer });
  }
  if (purpose === 'rent') {
    faq.push({
      q: t('seo.faqDepositQ'),
      a: [depositMonths != null && stats.depositCount > 0 ? t('seo.faqDepositA', { count: stats.depositCount, months: depositMonths }) : null,
          t('seo.faqDepositExplain')].filter(Boolean).join(' '),
    });
  }
  faq.push({ q: t('seo.faqContactQ'), a: t('seo.faqContactA') });
  faq.push({ q: t('seo.faqAlertQ'), a: t('seo.faqAlertA') });

  // ---- breadcrumb ----
  const crumbs = [
    { label: t('breadcrumb.home'), href: '/' },
    { label: transaction === 'location' ? t('seo.breadcrumbRent') : t('seo.breadcrumbSale'), href: `/${transaction}` },
  ];
  if (page.propertyType) crumbs.push({ label: type, href: seoPath({ transaction, propertyType: page.propertyType }) });
  if (page.commune) crumbs.push({ label: place, href: path });
  crumbs[crumbs.length - 1] = { label: crumbs[crumbs.length - 1].label };

  const refineHref = listingsHrefFor(filters);
  const guideOrder = purpose === 'sale'
    ? ['acheter-parcelle-kinshasa-diaspora', 'parcelle-maison-appartement-kinshasa', 'louer-sans-arnaque-kinshasa']
    : ['garantie-3-1-1-kinshasa', 'louer-sans-arnaque-kinshasa', 'parcelle-maison-appartement-kinshasa'];
  const guides = guideOrder.map((s) => GUIDES.find((g) => g.slug === s)).filter(Boolean);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          ...crumbs.slice(0, -1).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: `${base}${c.href === '/' ? '' : c.href}` })),
          { '@type': 'ListItem', position: crumbs.length, name: crumbs[crumbs.length - 1].label, item: `${base}${path}` },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: heading,
        url: `${base}${path}`,
        inLanguage: t.locale === 'en' ? 'en' : 'fr',
        about: { '@type': 'Place', name: page.commune ? `${page.commune}, Kinshasa` : 'Kinshasa', address: { '@type': 'PostalAddress', addressLocality: page.commune || 'Kinshasa', addressRegion: 'Kinshasa', addressCountry: 'CD' } },
        mainEntity: listings.length
          ? {
              '@type': 'ItemList',
              numberOfItems: stats.total,
              itemListElement: listings.map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/listings/${l.id}` })),
            }
          : undefined,
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  };

  return (
    <div className="pb-16">
      <JsonLd data={jsonLd} />
      <div className="mx-auto max-w-[1600px] px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <Breadcrumb className="mb-5" items={crumbs} />

        <header className="flex flex-col gap-3">
          <h1 className="font-display text-[1.875rem] font-normal leading-[1.15] tracking-[-0.01em] text-ink sm:text-[2.5rem]">
            {heading}
          </h1>
          <p className="max-w-3xl text-[1.0625rem] leading-relaxed text-ink-45">
            {stats.total > 0 ? t('seo.lead', { count: stats.total }) : t('seo.leadNone')}
          </p>
          <div className="mt-1 flex flex-wrap gap-3">
            <Link
              href={refineHref}
              className="u-press inline-flex items-center gap-2 rounded-lg bg-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
            >
              {stats.total > 0 ? t('seo.refine') : t('seo.createAlert')}
              <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
          </div>
        </header>

        {listings.length > 0 ? (
          <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((listing, i) => (
              <li key={listing.id}>
                <PropertyCard listing={listing} priority={i < 4} />
              </li>
            ))}
          </ul>
        ) : null}

        {stats.total > listings.length ? (
          <div className="mt-6">
            <Link href={refineHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-deep hover:underline">
              {t('seo.refine')}
              <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
          </div>
        ) : null}

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-10">
            {stats.total > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-h2 text-ink">{t('seo.statsTitle')}</h2>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label={t('seo.statsListings')} value={stats.total} />
                  {showRange ? <Stat label={t('seo.statsRange')} value={`${price(stats.priceMin)} – ${price(stats.priceMax)}`} /> : null}
                  {showMedian ? (
                    <Stat label={t('seo.statsMedian')} value={price(stats.priceMedian)} note={t('seo.statsMedianNote', { count: stats.pricedCount })} />
                  ) : null}
                  {purpose === 'rent' && depositMonths != null ? (
                    <Stat label={t('seo.statsDeposit')} value={t('seo.statsDepositValue', { months: depositMonths })} note={t('seo.statsMedianNote', { count: stats.depositCount })} />
                  ) : null}
                  {stats.bedsMin != null && stats.bedsMax != null && stats.bedsMin !== stats.bedsMax ? (
                    <Stat label={t('seo.statsBeds')} value={t('seo.statsBedsRange', { min: stats.bedsMin, max: stats.bedsMax })} />
                  ) : null}
                </dl>
                <p className="text-xs text-ink-45">{t('seo.statsSource')}</p>
              </section>
            ) : null}

            {stats.quartiers.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-h2 text-ink">{t('seo.quartiersTitle')}</h2>
                <p className="text-[0.9375rem] leading-relaxed text-ink-70">
                  {stats.quartiers.map((q) => `${q.name} (${q.count})`).join(' · ')}
                </p>
              </section>
            ) : null}

            <section className="flex flex-col gap-4">
              <h2 className="u-h2 text-ink">{t('seo.faqTitle')}</h2>
              <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
                {faq.map(({ q, a }) => (
                  <div key={q} className="flex flex-col gap-1.5 p-4 sm:p-5">
                    <h3 className="text-[0.9375rem] font-semibold text-ink">{q}</h3>
                    <p className="text-[0.9375rem] leading-relaxed text-ink-70">{a}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-8">
            <LinkList title={stats.total === 0 && page.commune ? t('seo.nearbyCommunes') : t('seo.otherCommunes')} links={communeLinks} />
            <LinkList title={t('seo.otherTypes', { transaction: txLabel, place })} links={typeLinks.filter((l) => l.href)} />
            <LinkList title={t('seo.otherTransaction')} links={seeAlso.filter((l) => l.href)} />
            {guides.length ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-h2 text-ink">{t('seo.guidesTitle')}</h2>
                <ul className="flex flex-col gap-2">
                  {guides.map((g) => (
                    <li key={g.slug}>
                      <Link href={`/guides/${g.slug}`} className="text-[0.9375rem] font-medium text-blue-deep hover:underline">
                        {g.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
