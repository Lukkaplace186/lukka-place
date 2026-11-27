import Link from '@/components/LocaleLink';
import JsonLd from '@/components/seo/JsonLd';
import { getT, localizedAlternates } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { DEFAULT_CITY, cityOfCommune, communeLabel } from '@/lib/cities';
import { SITE_URL } from '@/lib/constants';
import { cachedPriceGuides, getLukkaIndex, MIN_PRICE_SAMPLE, priceQuestion } from '@/lib/browseFeatures';
import { formatGuideDay, guidesUpdatedOn, priceGuideIndexJsonLd } from '@/lib/priceGuideSeo';
import { cachedSeoFacets } from '@/lib/listingsCached';
import { landingPathsFromFacets, seoPath } from '@/lib/seoPages';
import { groupGuidesByCommune, priceExamples } from '@/lib/priceGuideLinks';

export const dynamic = 'force-dynamic';

const base = SITE_URL.replace(/\/+$/, '');
const currentYear = () => new Date().getUTCFullYear();

export async function generateMetadata() {
  const t = await getT();
  const guides = await cachedPriceGuides();
  const year = currentYear();
  // The answer in the snippet itself (SEO plan 2026-11-26): Google's AI
  // overview quoted competitors' vague ranges for "prix loyer kinshasa"; this
  // gives it the real medians, by commune, with the number of pages behind them.
  const examples = priceExamples(guides, 2, 3).map((g) => `${communeLabel(g.commune)} ${frNumber(g.median)} $`).join(', ');
  return {
    title: t('home.prices.indexMetaTitle', { year }),
    description: examples
      ? t('home.prices.indexMetaDescription', { examples, pages: guides.length })
      : t('home.prices.indexMetaDescriptionPlain'),
    alternates: await localizedAlternates('/combien-coute'),
  };
}

/**
 * "Prix des loyers à Kinshasa" (growth plan item 28; renamed 2026-11-26 after
 * the words people search — it was "Combien coûte un logement ?", with no
 * Kinshasa, prix or loyer in it). Every commune × bedroom count with at least
 * MIN_PRICE_SAMPLE long-term rentals — Lukka Place's public listings plus
 * asking prices seen elsewhere in 2026 (lib/marketGuide.js) — grouped by
 * commune, each group linking to that commune's listings. A pair with fewer
 * listings has no page.
 *
 * 2026-11-21: "Mis à jour le" = the newest data date across every guide
 * (lib/priceGuideSeo.js guidesUpdatedOn), and a schema.org Dataset listing
 * each guide page as a part.
 */
export default async function PriceGuidesIndex() {
  const t = await getT();
  const [guides, facets, lukkaIndex] = await Promise.all([
    cachedPriceGuides(),
    cachedSeoFacets().catch(() => []),
    getLukkaIndex(),
  ]);
  const live = new Set(landingPathsFromFacets(facets));
  const groups = groupGuidesByCommune(guides);
  const title = t('home.prices.indexTitle', { year: currentYear() });
  const updatedOn = guidesUpdatedOn(guides);
  const updated = formatGuideDay(updatedOn, t.locale);
  const lead = t('home.prices.indexLead', { n: MIN_PRICE_SAMPLE });
  const jsonLd = guides.length
    ? priceGuideIndexJsonLd({
        base,
        path: '/combien-coute',
        name: title,
        description: lead,
        method: t('home.prices.method'),
        cities: [...new Set(guides.map((guide) => cityOfCommune(guide.commune) || DEFAULT_CITY))],
        updatedOn,
        guides: guides.map((guide) => ({
          slug: guide.slug,
          name: priceQuestion(t, { beds: guide.beds, commune: communeLabel(guide.commune) }),
          description: t('home.prices.answer', { median: frNumber(guide.median), n: guide.listings }),
        })),
      })
    : null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <JsonLd data={jsonLd} />
      <h1 className="u-title-hero text-ink">{title}</h1>
      {updated ? (
        <p className="u-micro mt-2 text-ink-45">
          <time dateTime={updatedOn}>{t('home.prices.updated', { date: updated })}</time>
        </p>
      ) : null}
      <p className="u-body mt-2 text-ink-70">{lead}</p>
      {lukkaIndex?.communes?.length ? (
        <p className="u-body mt-2">
          <Link href="/indice-lukka" className="font-semibold text-blue-deep underline-offset-2 hover:underline">{t('home.prices.indexIndexLink')}</Link>
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="u-body mt-6 text-ink-70">{t('home.prices.none')}</p>
      ) : (
        groups.map(({ commune, guides: rows }) => {
          const label = communeLabel(commune);
          const listingsPath = seoPath({ transaction: 'location', commune });
          return (
            <section key={commune} className="mt-8">
              <h2 className="u-title-section text-ink">{t('home.prices.communeHeading', { commune: label })}</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {rows.map((guide) => (
                  <li key={guide.slug}>
                    <Link href={`/combien-coute/${guide.slug}`} className="u-press flex items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)]">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[0.9375rem] font-bold text-ink">
                          {priceQuestion(t, { beds: guide.beds, commune: label })}
                        </span>
                        <span className="u-micro text-ink-45">{t('home.prices.cardCount', { n: guide.listings })}</span>
                      </span>
                      <span className="u-tabular shrink-0 text-[0.9375rem] font-bold text-blue-deep">{frNumber(guide.median)} $</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {listingsPath && live.has(listingsPath) ? (
                <p className="u-micro mt-2">
                  <Link href={listingsPath} className="font-semibold text-blue-deep underline-offset-2 hover:underline">
                    {t('home.prices.listingsInCommune', { commune: label })}
                  </Link>
                </p>
              ) : null}
            </section>
          );
        })
      )}
      {updated ? <p className="u-micro mt-6 text-ink-45">{t('home.prices.updatedNote')}</p> : null}
    </div>
  );
}
