import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { communeLabel } from '@/lib/cities';
import { getPriceGuides, MIN_PRICE_SAMPLE, priceQuestion } from '@/lib/browseFeatures';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t('home.prices.indexTitle')} — Lukka Place`, description: t('home.prices.indexLead', { n: MIN_PRICE_SAMPLE }), alternates: { canonical: '/combien-coute' } };
}

/**
 * "Combien coûte… ?" (growth plan item 28): every commune × bedroom count with
 * at least MIN_PRICE_SAMPLE live long-term rentals, from public listings only
 * (lib/browseFeatures.js). A pair with fewer listings has no page.
 */
export default async function PriceGuidesIndex() {
  const t = await getT();
  const guides = await getPriceGuides();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="u-title-hero text-ink">{t('home.prices.indexTitle')}</h1>
      <p className="u-body mt-2 text-ink-70">{t('home.prices.indexLead', { n: MIN_PRICE_SAMPLE })}</p>
      {guides.length === 0 ? (
        <p className="u-body mt-6 text-ink-70">{t('home.prices.none')}</p>
      ) : (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {guides.map((guide) => (
            <li key={guide.slug}>
              <Link href={`/combien-coute/${guide.slug}`} className="u-press flex items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)]">
                <span className="text-[0.9375rem] font-bold text-ink">
                  {priceQuestion(t, { beds: guide.beds, commune: communeLabel(guide.commune) })}
                </span>
                <span className="u-tabular shrink-0 text-[0.9375rem] font-bold text-blue-deep">{frNumber(guide.median)} $</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
