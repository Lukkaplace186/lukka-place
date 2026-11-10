import { cache } from 'react';
import Link from '@/components/LocaleLink';
import BlogChart from '@/components/blog/BlogChart';
import { getPriceGuides } from '@/lib/browseFeatures';
import { communeLabel } from '@/lib/cities';
import { frNumber } from '@/lib/format';

/**
 * `:::prix`: the price guide's medians (the same figures as /combien-coute),
 * read live so an article written once stays right. A commune without
 * enough listings is named as such, never given a number we do not have.
 * `:::annonces` is components/blog/LiveListings.js.
 */

const priceGuides = cache(getPriceGuides);

/** Medians for one commune by bedrooms, or several communes at one bedroom count. */
export async function LivePrices({ block, t, locale }) {
  const guides = await priceGuides();
  const { communes, beds } = block;
  const rows = [];
  const missing = [];
  if (communes.length === 1 && !beds) {
    for (const g of guides.filter((g) => g.commune === communes[0]).sort((a, b) => a.beds - b.beds)) rows.push({ label: t('guides.blocks.bedsLabel', { beds: g.beds }), g });
    if (!rows.length) missing.push(communeLabel(communes[0]));
  } else {
    for (const commune of communes) {
      const g = guides.find((x) => x.commune === commune && x.beds === beds);
      if (g) rows.push({ label: communeLabel(commune), g });
      else missing.push(communeLabel(commune));
    }
  }
  const title = communes.length === 1 && !beds
    ? t('guides.blocks.pricesByBeds', { commune: communeLabel(communes[0]) })
    : t('guides.blocks.pricesByCommune', { beds });
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeZone: 'Africa/Kinshasa' }).format(new Date());
  const total = rows.reduce((sum, r) => sum + r.g.listings, 0);

  return (
    <div className="flex flex-col gap-2">
      {rows.length ? (
        <BlogChart
          chart={{
            kind: 'bar',
            title,
            unit: '$',
            series: [],
            points: rows.map(({ label, g }) => ({
              label,
              values: [g.median],
              href: `/combien-coute/${g.slug}`,
              note: t('guides.blocks.priceRange', { low: frNumber(g.p25), high: frNumber(g.p75), n: g.listings }),
            })),
          }}
          caption={t('guides.blocks.pricesCaption', { n: total, date })}
        />
      ) : null}
      {missing.length ? (
        <p className="u-micro rounded-lg bg-canvas-alt px-3.5 py-2.5 text-ink-70">
          {t('guides.blocks.pricesMissing', { communes: missing.join(', ') })}
        </p>
      ) : null}
      <Link href="/combien-coute" className="u-micro-strong self-start text-blue-deep hover:underline">
        {t('guides.blocks.pricesLink')} →
      </Link>
    </div>
  );
}
