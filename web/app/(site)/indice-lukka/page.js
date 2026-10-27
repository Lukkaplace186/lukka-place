import { getT, getLocale } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { communeLabel } from '@/lib/cities';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import { SITE_URL } from '@/lib/constants';
import { MIN_PRICE_SAMPLE, getLukkaIndex } from '@/lib/browseFeatures';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t('home.index.title')} — Lukka Place`, description: t('home.index.lead', { n: MIN_PRICE_SAMPLE }), alternates: { canonical: '/indice-lukka' } };
}

/**
 * The monthly Lukka Index (growth plan item 31): median asking rent per
 * commune from the monthly market snapshots, with the change on the month
 * before where both months have enough listings. The image (./opengraph-image.js)
 * is the version for press and social media.
 */
export default async function LukkaIndexPage() {
  const t = await getT();
  const locale = await getLocale();
  const index = await getLukkaIndex();
  const month = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="u-title-hero text-ink">{t('home.index.title')}</h1>
      <p className="u-body mt-2 text-ink-70">{t('home.index.lead', { n: MIN_PRICE_SAMPLE })}</p>
      {!index?.communes?.length ? (
        <p className="u-body mt-6 text-ink-70">{t('home.index.none')}</p>
      ) : (
        <>
          <p className="u-micro-strong mt-5 text-ink-45">{t('home.index.month', { month: month(index.month) })}</p>
          <table className="mt-3 w-full text-left">
            <thead>
              <tr className="u-micro text-ink-45">
                <th className="py-2 font-semibold">{t('home.index.commune')}</th>
                <th className="py-2 text-right font-semibold">{t('home.index.median')}</th>
                <th className="py-2 text-right font-semibold">{t('home.index.change')}</th>
              </tr>
            </thead>
            <tbody>
              {index.communes.map((row) => (
                <tr key={row.commune} className="border-t border-line">
                  <td className="py-2.5 font-semibold text-ink">{communeLabel(row.commune)}</td>
                  <td className="u-tabular py-2.5 text-right font-bold text-ink">{frNumber(row.median)} $</td>
                  <td className="u-tabular py-2.5 text-right text-ink-70">
                    {row.changePct == null ? '—' : `${row.changePct > 0 ? '+' : ''}${frNumber(row.changePct)} %`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 flex flex-wrap gap-2">
            <a href="/indice-lukka/image" download="indice-lukka.png" className="u-micro-strong inline-flex h-10 items-center rounded-lg px-4 text-blue-deep ring-1 ring-inset ring-line">
              {t('home.index.download')}
            </a>
            <ShareOnWhatsAppButton url={`${SITE_URL}/indice-lukka`} />
          </div>
          <p className="u-micro mt-4 text-ink-45">{t('home.index.method', { n: MIN_PRICE_SAMPLE })}</p>
        </>
      )}
    </div>
  );
}
