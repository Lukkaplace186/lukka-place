import Link from '@/components/LocaleLink';
import { notFound } from 'next/navigation';
import { BellRing } from 'lucide-react';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import QueryAlertButton from '@/components/QueryAlertButton';
import JsonLd from '@/components/seo/JsonLd';
import { getT, getUrlLocale, localizedAlternates } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { cityOfCommune, communeLabel } from '@/lib/cities';
import { ICON_STROKE_WIDTH, SITE_URL } from '@/lib/constants';
import { cachedPriceGuides, getPriceGuide, priceQuestion } from '@/lib/browseFeatures';
import { cachedSeoFacets } from '@/lib/listingsCached';
import { landingPathsFromFacets, seoPath } from '@/lib/seoPages';
import { relatedGuides } from '@/lib/priceGuideLinks';
import { SOURCE_NAMES } from '@/lib/marketObservationRules';
import { guideSearchHref } from '@/lib/homeMarket';
import { formatGuideDay, guideAlertQuery, priceGuideDatasetJsonLd } from '@/lib/priceGuideSeo';
import { localizeHref } from '@/lib/localePaths';

export const dynamic = 'force-dynamic';

const base = SITE_URL.replace(/\/+$/, '');

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const guide = await getPriceGuide(slug);
  if (!guide) return { robots: { index: false, follow: true } };
  const t = await getT();
  const question = priceQuestion(t, { beds: guide.beds, commune: communeLabel(guide.commune) });
  const description = t('home.prices.answer', { median: frNumber(guide.median), n: guide.listings });
  const path = `/combien-coute/${guide.slug}`;
  // "Prix d'un 2 chambres à louer à Limete en 2026 : 500 $ / mois" — the
  // searched words and the answer in the title (SEO plan 2026-11-26).
  const vars = { beds: guide.beds, commune: communeLabel(guide.commune), year: new Date().getUTCFullYear(), median: frNumber(guide.median) };
  // og:image / twitter:image come from ./opengraph-image.js and
  // ./twitter-image.js (the question, the median, the count and the date).
  return {
    title: t(guide.beds === 1 ? 'home.prices.detailMetaTitleOne' : 'home.prices.detailMetaTitle', vars),
    description,
    alternates: await localizedAlternates(path),
    openGraph: {
      title: question,
      description,
      url: (await getUrlLocale()) === 'en' ? localizeHref(path, 'en') : path,
      type: 'article',
      ...(guide.updatedOn ? { modifiedTime: guide.updatedOn } : {}),
    },
    twitter: { card: 'summary_large_image', title: question, description },
  };
}

/**
 * One "Combien coûte un 2 chambres à Gombe ?" page: the median monthly asking
 * rent, the middle half of the market (p25–p75), how many listings it rests
 * on and where they were seen, and the search that shows Lukka Place's own.
 * Asking prices, said so — not closing prices. No loading.js above it, so an
 * unknown slug is a real 404.
 *
 * 2026-11-21 (marketing plan): a visible "Mis à jour le" from the data itself
 * (lib/marketGuide.js UPDATED_ON_SQL — never the request's clock), schema.org
 * Dataset JSON-LD with only what the page shows (lib/priceGuideSeo.js), a
 * share image (./opengraph-image.js), and an alert for new rentals in the
 * commune through the existing saved-search alert, sign-up entry
 * `price_guide`. The alert sends listings, not prices — the copy says so.
 */
export default async function PriceGuidePage({ params }) {
  const { slug } = await params;
  const guide = await getPriceGuide(slug);
  if (!guide) notFound();
  const t = await getT();
  const commune = communeLabel(guide.commune);
  const city = cityOfCommune(guide.commune);
  const question = priceQuestion(t, { beds: guide.beds, commune });
  // The homepage's market band opens the same search (lib/homeMarket.js).
  const searchHref = guideSearchHref(guide.commune, guide.beds);
  const market = Math.max(0, guide.listings - guide.lukkaListings);
  // Per-source counts are before de-duplication, so they are named, not summed.
  const sourceList = Object.entries(guide.sources || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source]) => {
      if (source === 'whatsapp_group') return t('home.prices.sourceWhatsapp');
      if (source === 'other') return t('home.prices.sourceOther');
      return SOURCE_NAMES[source] || source;
    })
    .join(', ');
  const answer = t('home.prices.answer', { median: frNumber(guide.median), n: guide.listings });
  const range = t('home.prices.range', { p25: frNumber(guide.p25), p75: frNumber(guide.p75) });
  const sourcesLine = `${market === 0
    ? t('home.prices.sourcesLukkaOnly')
    : guide.lukkaListings === 0
      ? t('home.prices.sourcesMarketOnly')
      : t('home.prices.sources', { lukka: guide.lukkaListings, count: market })}${sourceList ? ` ${t('home.prices.sourceList', { list: sourceList })}` : ''}`;
  const method = t('home.prices.method');
  const updated = formatGuideDay(guide.updatedOn, t.locale);
  const alertQuery = guideAlertQuery({ commune: guide.commune, beds: guide.beds, city });

  const jsonLd = priceGuideDatasetJsonLd({
    base,
    path: `/combien-coute/${guide.slug}`,
    name: question,
    description: `${answer} ${range} ${sourcesLine}`,
    method,
    guide,
    place: commune,
    city,
    updatedOn: guide.updatedOn,
  });

  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-8">
      <JsonLd data={jsonLd} />
      <Link href="/combien-coute" className="u-micro-strong text-ink-70 hover:text-ink">{t('home.prices.indexTitle', { year: new Date().getUTCFullYear() })}</Link>
      <h1 className="u-title-hero mt-2 text-ink">{question}</h1>
      {updated ? (
        <p className="u-micro mt-2 text-ink-45">
          <time dateTime={guide.updatedOn}>{t('home.prices.updated', { date: updated })}</time>
        </p>
      ) : null}
      <p className="u-stat mt-5 text-blue-deep">{frNumber(guide.median)} $ <span className="text-[1rem] font-semibold text-ink-45">{t('home.prices.perMonth')}</span></p>
      <p className="u-body mt-2 text-ink-70">{answer}</p>
      <p className="u-body mt-2 text-ink-70">{range}</p>
      <p className="u-body mt-2 text-ink-70">{sourcesLine}</p>
      <p className="u-micro mt-4 text-ink-45">{method}</p>
      {updated ? <p className="u-micro mt-1 text-ink-45">{t('home.prices.updatedNote')}</p> : null}
      <div className="mt-6 flex flex-wrap gap-2">
        {/* The search shows Lukka Place's own listings only — never an
            advert seen elsewhere — so the button counts those. */}
        {guide.lukkaListings > 0 ? (
          <Link href={searchHref} className="u-btn-primary u-press inline-flex h-11 items-center rounded-lg bg-blue px-5 text-sm font-bold text-white">
            {t('home.prices.see', { count: guide.lukkaListings })}
          </Link>
        ) : null}
        <ShareOnWhatsAppButton url={`${SITE_URL}/combien-coute/${guide.slug}`} message={`${question} ${frNumber(guide.median)} $ / mois — Lukka Place`} />
      </div>
      {alertQuery ? (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
              <BellRing strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="u-title-card text-ink">{t('home.prices.alertTitle', { commune })}</h2>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-70">{t('home.prices.alertLead', { count: guide.beds, commune })}</p>
            </div>
          </div>
          {/* The existing saved-search alert (QueryAlertButton): signed in →
              confirm and save; a guest → sign-up with entry `price_guide`,
              then the alert is saved on /listings once the account exists. */}
          <QueryAlertButton query={alertQuery} label={t('home.prices.alertButton', { commune })} trigger="price_guide" fullWidth className="mt-4" />
          <p className="u-micro mt-3 text-ink-45">{t('home.prices.alertNote')}</p>
        </section>
      ) : null}
      <GuideNeighbours guide={guide} commune={commune} t={t} />
    </article>
  );
}

/**
 * The other bedroom counts in this commune, the same bedroom count elsewhere
 * and the commune's listings (SEO plan 2026-11-26): a price page linked only
 * back to the hub, so Google found most of them from there alone.
 */
async function GuideNeighbours({ guide, commune, t }) {
  const [guides, facets] = await Promise.all([cachedPriceGuides(), cachedSeoFacets().catch(() => [])]);
  const { sameCommune, sameBeds } = relatedGuides(guides, guide);
  const listingsPath = seoPath({ transaction: 'location', commune: guide.commune });
  const showListings = listingsPath && new Set(landingPathsFromFacets(facets)).has(listingsPath);
  const row = (g) => (
    <li key={g.slug}>
      <Link href={`/combien-coute/${g.slug}`} className="u-press flex min-h-11 items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-ink hover:border-ink-25">
        <span className="text-[0.9375rem] font-semibold">{priceQuestion(t, { beds: g.beds, commune: communeLabel(g.commune) })}</span>
        <span className="u-tabular shrink-0 text-[0.9375rem] font-bold text-blue-deep">{frNumber(g.median)} $</span>
      </Link>
    </li>
  );
  if (!sameCommune.length && !sameBeds.length && !showListings) return null;
  return (
    <div className="mt-10 flex flex-col gap-8">
      {sameCommune.length ? (
        <section>
          <h2 className="u-title-card text-ink">{t('home.prices.sameCommune', { commune })}</h2>
          <ul className="mt-3 flex flex-col gap-2">{sameCommune.map(row)}</ul>
        </section>
      ) : null}
      {sameBeds.length ? (
        <section>
          <h2 className="u-title-card text-ink">{guide.beds === 1 ? t('home.prices.sameBedsOne') : t('home.prices.sameBeds', { beds: guide.beds })}</h2>
          <ul className="mt-3 flex flex-col gap-2">{sameBeds.map(row)}</ul>
        </section>
      ) : null}
      {showListings ? (
        <p className="u-body">
          <Link href={listingsPath} className="font-semibold text-blue-deep underline-offset-2 hover:underline">{t('home.prices.listingsInCommune', { commune })}</Link>
        </p>
      ) : null}
    </div>
  );
}
