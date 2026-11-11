import Link from '@/components/LocaleLink';
import { getLocale, getT } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { communeLabel } from '@/lib/cities';
import { MIN_SAMPLE } from '@/lib/marketBenchmarks';
import { DATA_MONTHS } from '@/lib/blogRules';
import SeriesChart, { money, monthLabel } from '@/components/blog/SeriesChart';
import { MIN_PRICE_SAMPLE } from '@/lib/browseFeatures';

/**
 * A live data block in a guide or post ({{indice …}} / {{prix …}}, grammar in
 * lib/blogRules.js, figures from lib/blogData.js). Server-rendered, no client
 * JavaScript: the chart is inline SVG whose points carry a native tooltip, and
 * a chart always comes with its numbers in a visually hidden table.
 *
 * Every figure is the market data's own: a month below MIN_SAMPLE asks prints
 * "—" beside its count, an empty source says so, and nothing is filled in.
 * An invalid block (refused at save, so only seen on an old post) renders
 * nothing publicly and a warning in the console preview.
 */


function Frame({ title, children, source, sourceHref, sourceLink }) {
  return (
    <figure className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
      <figcaption className="u-title-card text-ink">{title}</figcaption>
      {children}
      <p className="u-micro text-ink-45">
        {source}
        {sourceHref ? (
          <>
            {' '}
            <Link href={sourceHref} className="font-semibold text-blue-deep underline underline-offset-2">{sourceLink}</Link>
          </>
        ) : null}
      </p>
    </figure>
  );
}

const Empty = ({ children }) => <p className="u-micro rounded-lg bg-canvas-alt px-3.5 py-3 text-ink-70">{children}</p>;

const TH = 'py-2 font-semibold';
const TD = 'py-2.5';

async function IndexSeries({ spec, t, locale }) {
  const commune = communeLabel(spec.commune);
  const sale = spec.purpose === 'sale';
  const title = t(sale ? 'guides.data.indexTitleSale' : 'guides.data.indexTitle', { commune, n: spec.months });
  const valueLabel = t(sale ? 'guides.data.medianSale' : 'guides.data.medianRent');
  const source = t('guides.data.indexSource', { n: MIN_SAMPLE });
  const frame = (body) => (
    <Frame title={title} source={source} sourceHref="/indice-lukka" sourceLink={t('guides.data.indexLink')}>{body}</Frame>
  );
  const { series, unavailable } = spec.result || {};
  if (unavailable) return frame(<Empty>{t('guides.data.unavailable')}</Empty>);
  if (!series?.length) return frame(<Empty>{t('guides.data.indexNoMonths', { commune })}</Empty>);
  const withMedian = series.filter((p) => p.median != null).length;

  const table = (hidden) => (
    <table className={hidden ? 'sr-only' : 'w-full text-left'}>
      <thead>
        <tr className="u-micro text-ink-45">
          <th className={TH}>{t('guides.data.month')}</th>
          <th className={`${TH} text-right`}>{valueLabel}</th>
          <th className={`${TH} text-right`}>{t('guides.data.asks')}</th>
        </tr>
      </thead>
      <tbody>
        {[...series].reverse().map((p) => (
          <tr key={p.month} className="border-t border-line">
            <td className={`${TD} font-semibold text-ink`}>{monthLabel(p.month, locale)}</td>
            <td className={`${TD} u-tabular text-right font-bold text-ink`}>{p.median == null ? '—' : money(p.median)}</td>
            <td className={`${TD} u-tabular text-right text-ink-70`}>{p.sample}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!withMedian) return frame(<Empty>{t('guides.data.indexThin', { commune, n: MIN_SAMPLE })}</Empty>);
  if (spec.view === 'chart') {
    return frame(
      <>
        <SeriesChart series={series} locale={locale} valueLabel={`${valueLabel} — ${commune}`} />
        {table(true)}
        {withMedian < series.length ? <p className="u-micro text-ink-45">{t('guides.data.gapNote', { n: MIN_SAMPLE })}</p> : null}
      </>,
    );
  }
  return frame(
    <>
      {table(false)}
      {withMedian < series.length ? <p className="u-micro text-ink-45">{t('guides.data.dashNote', { n: MIN_SAMPLE })}</p> : null}
    </>,
  );
}

async function IndexAll({ spec, t, locale }) {
  const { index, unavailable } = spec.result || {};
  const title = index?.month
    ? t('guides.data.indexAllTitleMonth', { month: monthLabel(index.month.slice(0, 7), locale) })
    : t('guides.data.indexAllTitle');
  const frame = (body) => (
    <Frame title={title} source={t('guides.data.indexSource', { n: MIN_SAMPLE })} sourceHref="/indice-lukka" sourceLink={t('guides.data.indexLink')}>{body}</Frame>
  );
  if (unavailable) return frame(<Empty>{t('guides.data.unavailable')}</Empty>);
  if (!index?.communes?.length) return frame(<Empty>{t('home.index.none')}</Empty>);
  return frame(
    <table className="w-full text-left">
      <thead>
        <tr className="u-micro text-ink-45">
          <th className={TH}>{t('home.index.commune')}</th>
          <th className={`${TH} text-right`}>{t('home.index.median')}</th>
          <th className={`${TH} text-right`}>{t('home.index.change')}</th>
        </tr>
      </thead>
      <tbody>
        {index.communes.map((row) => (
          <tr key={row.commune} className="border-t border-line">
            <td className={`${TD} font-semibold text-ink`}>{communeLabel(row.commune)}</td>
            <td className={`${TD} u-tabular text-right font-bold text-ink`}>{money(row.median)}</td>
            <td className={`${TD} u-tabular text-right text-ink-70`}>
              {row.changePct == null ? '—' : `${row.changePct > 0 ? '+' : ''}${frNumber(row.changePct)} %`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>,
  );
}

async function PriceGuide({ spec, t }) {
  const commune = communeLabel(spec.commune);
  const title = spec.beds ? t(spec.beds === 1 ? 'home.prices.questionOne' : 'home.prices.question', { beds: spec.beds, commune }) : t('guides.data.pricesTitle', { commune });
  const { guides, unavailable } = spec.result || {};
  const only = guides?.length === 1 ? guides[0] : null;
  const frame = (body) => (
    <Frame
      title={title}
      source={t('guides.data.pricesSource', { n: MIN_PRICE_SAMPLE })}
      sourceHref={only ? `/combien-coute/${only.slug}` : '/combien-coute'}
      sourceLink={t('guides.data.pricesLink')}
    >
      {body}
    </Frame>
  );
  if (unavailable) return frame(<Empty>{t('guides.data.unavailable')}</Empty>);
  if (!guides?.length) return frame(<Empty>{t('guides.data.pricesNone', { commune, n: MIN_PRICE_SAMPLE })}</Empty>);
  return frame(
    <table className="w-full text-left">
      <thead>
        <tr className="u-micro text-ink-45">
          <th className={TH}>{t('guides.data.beds')}</th>
          <th className={`${TH} text-right`}>{t('guides.data.medianRent')}</th>
          <th className={`${TH} text-right`}>{t('guides.data.range')}</th>
          <th className={`${TH} text-right`}>{t('guides.data.listings')}</th>
        </tr>
      </thead>
      <tbody>
        {guides.map((g) => (
          <tr key={g.beds} className="border-t border-line">
            <td className={`${TD} font-semibold text-ink`}>{t('guides.data.bedsCount', { n: g.beds })}</td>
            <td className={`${TD} u-tabular text-right font-bold text-ink`}>{money(g.median)}</td>
            <td className={`${TD} u-tabular text-right text-ink-70`}>{`${frNumber(g.p25)} – ${money(g.p75)}`}</td>
            <td className={`${TD} u-tabular text-right text-ink-70`}>{g.listings}</td>
          </tr>
        ))}
      </tbody>
    </table>,
  );
}

export default async function DataBlock({ spec, preview = false }) {
  const t = await getT();
  if (spec.error) {
    if (!preview) return null;
    return (
      <p className="u-micro rounded-lg border border-danger/40 bg-canvas-alt px-3.5 py-2.5 text-danger">
        {t('admin.blog.errors.badEmbed', { line: spec.source, reason: t(`admin.blog.embedErrors.${spec.error}`, { min: DATA_MONTHS.min, max: DATA_MONTHS.max }) })}
      </p>
    );
  }
  const locale = await getLocale();
  if (spec.kind === 'prix') return <PriceGuide spec={spec} t={t} />;
  if (!spec.commune) return <IndexAll spec={spec} t={t} locale={locale} />;
  return <IndexSeries spec={spec} t={t} locale={locale} />;
}
