import Link from '@/components/LocaleLink';
import { getT, getLocale } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { communeLabel } from '@/lib/cities';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import { SITE_URL } from '@/lib/constants';
import { MIN_PRICE_SAMPLE, getLukkaIndex } from '@/lib/browseFeatures';
import { dayLabel, sourceList } from './sources';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t('home.index.title')} — Lukka Place`, description: t('home.index.lead', { n: MIN_PRICE_SAMPLE }), alternates: { canonical: '/indice-lukka' } };
}

/**
 * The Lukka Index (growth plan item 31): the median asking rent per commune,
 * Lukka Place's listings blended with the asking prices seen elsewhere
 * (lib/lukkaIndex.js), with the change on the same calculation one month
 * earlier once that can be computed the same way. The method is public at
 * /indice-lukka/methodologie; the image (./opengraph-image.js) is the version
 * for press and social media.
 */
export default async function LukkaIndexPage() {
  const t = await getT();
  const locale = await getLocale();
  const index = await getLukkaIndex();
  const day = (value) => dayLabel(value, locale);
  const market = index ? sourceList(t, index.sources) : '';
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="u-title-hero text-ink">{t('home.index.title')}</h1>
      <p className="u-body mt-2 text-ink-70">{t('home.index.lead', { n: MIN_PRICE_SAMPLE })}</p>
      {!index?.communes?.length ? (
        <p className="u-body mt-6 text-ink-70">{t('home.index.none')}</p>
      ) : (
        <>
          <p className="u-micro-strong mt-5 text-ink-45">{t('home.index.asOf', { date: day(index.asOf) })}</p>
          <table className="mt-3 w-full text-left">
            <thead>
              <tr className="u-micro text-ink-45">
                <th className="py-2 font-semibold">{t('home.index.commune')}</th>
                <th className="py-2 text-right font-semibold">{t('home.index.median')}</th>
                <th className="py-2 pl-3 text-right font-semibold">{t('home.index.change')}</th>
              </tr>
            </thead>
            <tbody>
              {index.communes.map((row) => (
                <tr key={row.commune} className="border-t border-line align-top">
                  <td className="py-2.5">
                    <span className="block font-semibold text-ink">{communeLabel(row.commune)}</span>
                    <span className="u-micro block text-ink-45">{row.lukkaListings > 0
                        ? t('home.index.count', { n: frNumber(row.listings), lukka: frNumber(row.lukkaListings) })
                        : t('home.index.countMarketOnly', { n: frNumber(row.listings) })}</span>
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="u-tabular block font-bold text-ink">{frNumber(row.median)} $</span>
                    <span className="u-micro u-tabular block text-ink-45">{t('home.index.range', { p25: frNumber(row.p25), p75: frNumber(row.p75) })}</span>
                  </td>
                  <td className="u-tabular py-2.5 pl-3 text-right text-ink-70">
                    {row.changePct == null ? '—' : `${row.changePct > 0 ? '+' : ''}${frNumber(row.changePct)} %`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="u-micro mt-3 text-ink-70">
            {t('home.index.totals', { listings: frNumber(index.listings), lukka: frNumber(index.lukkaListings) })}
            {market ? ` ${t('home.index.sourcesLine', { list: market })}` : ''}
          </p>
          <p className="u-micro mt-1 text-ink-45">
            {index.comparable
              ? t('home.index.changeNote', { date: day(index.previousAsOf), n: MIN_PRICE_SAMPLE })
              : t('home.index.changePending', { first: day(index.firstChange), start: day(index.comparableFrom) })}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <a href="/indice-lukka/image" download="indice-lukka.png" className="u-micro-strong inline-flex h-10 items-center rounded-lg px-4 text-blue-deep ring-1 ring-inset ring-line">
              {t('home.index.download')}
            </a>
            <ShareOnWhatsAppButton url={`${SITE_URL}/indice-lukka`} />
          </div>
          <p className="u-micro mt-4 text-ink-45">{t('home.index.method')}</p>
        </>
      )}
      <p className="u-micro-strong mt-3">
        <Link href="/indice-lukka/methodologie" className="text-blue-deep underline underline-offset-2">{t('home.index.methodLink')}</Link>
      </p>
    </div>
  );
}
