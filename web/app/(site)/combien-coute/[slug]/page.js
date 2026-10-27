import Link from 'next/link';
import { notFound } from 'next/navigation';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import { getT } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { communeLabel } from '@/lib/cities';
import { SITE_URL } from '@/lib/constants';
import { getPriceGuide, priceQuestion } from '@/lib/browseFeatures';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const guide = await getPriceGuide(slug);
  if (!guide) return { robots: { index: false, follow: true } };
  const t = await getT();
  const question = priceQuestion(t, { beds: guide.beds, commune: communeLabel(guide.commune) });
  return {
    title: `${question} — Lukka Place`,
    description: t('home.prices.answer', { median: frNumber(guide.median), n: guide.listings }),
    alternates: { canonical: `/combien-coute/${guide.slug}` },
  };
}

/**
 * One "Combien coûte un 2 chambres à Gombe ?" page: the median monthly asking
 * rent, the middle half of the market (p25–p75), how many listings it rests
 * on, and the search that shows them. Asking prices, said so — not closing
 * prices. No loading.js above it, so an unknown slug is a real 404.
 */
export default async function PriceGuidePage({ params }) {
  const { slug } = await params;
  const guide = await getPriceGuide(slug);
  if (!guide) notFound();
  const t = await getT();
  const commune = communeLabel(guide.commune);
  const question = priceQuestion(t, { beds: guide.beds, commune });
  const searchHref = `/listings?transaction_type=location&commune=${encodeURIComponent(guide.commune)}&beds_min=${guide.beds}&lease_term=long`;
  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link href="/combien-coute" className="u-micro-strong text-ink-70 hover:text-ink">{t('home.prices.indexTitle')}</Link>
      <h1 className="u-title-hero mt-2 text-ink">{question}</h1>
      <p className="u-stat mt-5 text-blue-deep">{frNumber(guide.median)} $ <span className="text-[1rem] font-semibold text-ink-45">{t('home.prices.perMonth')}</span></p>
      <p className="u-body mt-2 text-ink-70">{t('home.prices.answer', { median: frNumber(guide.median), n: guide.listings })}</p>
      <p className="u-body mt-2 text-ink-70">{t('home.prices.range', { p25: frNumber(guide.p25), p75: frNumber(guide.p75) })}</p>
      <p className="u-micro mt-4 text-ink-45">{t('home.prices.method')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={searchHref} className="u-btn-primary u-press inline-flex h-11 items-center rounded-lg bg-blue px-5 text-sm font-bold text-white">
          {t('home.prices.see', { n: guide.listings })}
        </Link>
        <ShareOnWhatsAppButton url={`${SITE_URL}/combien-coute/${guide.slug}`} message={`${question} ${frNumber(guide.median)} $ / mois — Lukka Place`} />
      </div>
    </article>
  );
}
