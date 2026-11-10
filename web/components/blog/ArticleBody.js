import { Info, Lightbulb, TriangleAlert } from 'lucide-react';
import Link from '@/components/LocaleLink';
import BlogChart from '@/components/blog/BlogChart';
import CountUp from '@/components/blog/CountUp';
import Reveal from '@/components/blog/Reveal';
import { LivePrices } from '@/components/blog/LiveBlocks';
import { parseFigure, postListingsHref } from '@/lib/blogRules';
import { getLocale, getT } from '@/lib/i18n/server';

/**
 * The body of a guide or a post (lib/blogRules.js blocks). Server-rendered.
 * Text is rendered as text — there is no HTML path — and a link is either a
 * site path or an https URL opened in a new tab with rel="noopener nofollow".
 *
 * Rich blocks (tables, charts, key figures, callouts, quotes, live prices
 * and listings) enter with <Reveal> as they scroll into view; the only
 * client JavaScript is that observer and the key figures' count-up.
 * `preview` (the console's /apercu) shows an unreadable block as a warning;
 * in public it is simply not drawn. `listingsBlock` draws `:::annonces`
 * (the public page passes components/blog/LiveListings.js); without it the
 * block is named with the search it links to.
 */
function Inline({ value }) {
  if (!Array.isArray(value)) return value;
  return value.map((segment, i) => {
    if (!segment.href) return <span key={i}>{segment.text}</span>;
    if (segment.href.startsWith('/')) {
      return (
        <Link key={i} href={segment.href} className="font-semibold text-blue-deep underline underline-offset-2">
          {segment.text}
        </Link>
      );
    }
    return (
      <a key={i} href={segment.href} target="_blank" rel="noopener nofollow" className="font-semibold text-blue-deep underline underline-offset-2">
        {segment.text}
      </a>
    );
  });
}

function Source({ source, t }) {
  if (!source) return null;
  return <p className="u-micro text-ink-45">{t('guides.blocks.source', { source })}</p>;
}

const isFigureCell = (cell) => typeof cell === 'string' && cell.length <= 24 && parseFigure(cell) !== null && /^[\d\s  .,+\-–$%€FCfc]+[a-zA-Z²$%]*$/.test(cell.replace(/\s?(USD|CDF|m²|mois|ans?)$/, ''));

/** A column is numeric when most of its filled cells are figures; it is right-aligned, header included. */
function figureColumns(table) {
  const width = (table.head || table.rows[0] || []).length;
  return Array.from({ length: width }, (_, i) => {
    const cells = table.rows.map((r) => r[i]).filter((c) => c !== '' && c != null);
    return i > 0 && cells.length > 0 && cells.filter(isFigureCell).length / cells.length >= 0.6;
  });
}

function Table({ table, t }) {
  const numeric = figureColumns(table);
  return (
    <figure className="flex flex-col gap-2">
      {table.title ? <figcaption className="u-title-card text-ink">{table.title}</figcaption> : null}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="u-micro w-full min-w-[28rem] border-separate border-spacing-0 overflow-hidden rounded-card bg-surface shadow-[var(--hairline)]">
          {table.head ? (
            <thead>
              <tr>
                {table.head.map((cell, i) => (
                  <th key={i} scope="col" className={`bg-blue-tint px-3 py-2.5 font-semibold text-blue-deep ${numeric[i] ? 'text-right' : 'text-left'}`}>
                    <Inline value={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="even:bg-canvas">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="border-t border-line px-3 py-2.5 text-left font-semibold text-ink">
                      <Inline value={cell} />
                    </th>
                  ) : (
                    <td key={i} className={`border-t border-line px-3 py-2.5 text-ink-70 ${numeric[i] ? 'u-tabular text-right' : ''}`}>
                      <Inline value={cell} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Source source={table.source} t={t} />
    </figure>
  );
}

function Stats({ stats, t }) {
  const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[stats.items.length];
  return (
    <div className="flex flex-col gap-2">
      <div className={`u-stagger grid grid-cols-2 gap-3 ${cols}`}>
        {stats.items.map((item, i) => (
          <div key={i} className="flex flex-col gap-1 rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)]">
            <span className="u-stat text-blue-deep">
              <CountUp value={item.value} />
            </span>
            <span className="u-micro text-ink-70">{item.label}</span>
          </div>
        ))}
      </div>
      <Source source={stats.source} t={t} />
    </div>
  );
}

const TONES = {
  tip: { icon: Lightbulb, box: 'bg-green-tint text-green-ink', key: 'tip' },
  warning: { icon: TriangleAlert, box: 'bg-warning-tint text-warning-ink', key: 'warning' },
  info: { icon: Info, box: 'bg-blue-tint text-blue-deep', key: 'info' },
};

function Callout({ callout, t }) {
  const tone = TONES[callout.tone] || TONES.info;
  const Icon = tone.icon;
  return (
    <aside className={`flex gap-3 rounded-card p-4 sm:p-5 ${tone.box}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-semibold">{callout.title || t(`guides.blocks.${tone.key}`)}</p>
        <div className="flex flex-col gap-2 text-ink-70">
          {callout.blocks.map((b, i) => (
            <TextBlock key={i} block={b} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function Quote({ quote }) {
  return (
    <blockquote className="flex flex-col gap-2 border-l-4 border-blue pl-4 sm:pl-5">
      <p className="text-xl font-semibold leading-snug text-ink">« <Inline value={quote.text} /> »</p>
      {quote.author ? (
        <footer className="u-micro text-ink-45">
          — {quote.author}
          {quote.role ? `, ${quote.role}` : ''}
        </footer>
      ) : null}
    </blockquote>
  );
}

function TextBlock({ block }) {
  if (block.h2) return <h2 className="u-h2 mt-4 text-ink">{block.h2}</h2>;
  if (block.p) return <p><Inline value={block.p} /></p>;
  if (block.ul) {
    return (
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {block.ul.map((item, i) => <li key={i}><Inline value={item} /></li>)}
      </ul>
    );
  }
  if (block.ol) {
    return (
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        {block.ol.map((item, i) => <li key={i}><Inline value={item} /></li>)}
      </ol>
    );
  }
  return null;
}

function RichBlock({ block, t, locale, ListingsBlock }) {
  if (block.table) return <Table table={block.table} t={t} />;
  if (block.stats) return <Stats stats={block.stats} t={t} />;
  if (block.chart) return <BlogChart chart={block.chart} caption={t('guides.blocks.source', { source: block.chart.source })} />;
  if (block.callout) return <Callout callout={block.callout} t={t} />;
  if (block.quote) return <Quote quote={block.quote} />;
  if (block.prices) return <LivePrices block={block.prices} t={t} locale={locale} />;
  if (block.listings) {
    if (ListingsBlock) return <ListingsBlock block={block.listings} t={t} />;
    const href = postListingsHref({ purpose: block.listings.transaction, commune: block.listings.commune, property_type: block.listings.propertyType });
    return (
      <p className="u-micro rounded-lg bg-canvas-alt px-3.5 py-2.5 text-ink-70">
        {t('guides.blocks.listingsPreview')} <span className="font-mono">{href}</span>
      </p>
    );
  }
  return null;
}

export default async function ArticleBody({ blocks, preview = false, listingsBlock = null }) {
  const list = blocks || [];
  if (!list.some((b) => !(b.h2 || b.p || b.ul || b.ol))) {
    // A plain article (every code guide): no translator, no client code.
    return list.map((block, i) => <TextBlock key={i} block={block} />);
  }
  const t = await getT();
  const locale = await getLocale();
  return list.map((block, i) => {
    if (block.h2 || block.p || block.ul || block.ol) return <TextBlock key={i} block={block} />;
    if (block.invalid) {
      return preview ? (
        <p key={i} className="u-micro rounded-lg bg-danger-tint px-3.5 py-2.5 text-danger">
          {t('guides.blocks.invalid', { name: block.invalid.name, reason: block.invalid.reason })}
        </p>
      ) : null;
    }
    return (
      <Reveal key={i} className="my-2">
        <RichBlock block={block} t={t} locale={locale} ListingsBlock={listingsBlock} />
      </Reveal>
    );
  });
}
