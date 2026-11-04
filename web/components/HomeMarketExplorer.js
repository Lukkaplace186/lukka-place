'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { frNumber } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The interactive half of HomeMarketBand: a commune picker, the median rent
 * of the picked bedroom count as the headline, and one bar per bedroom count
 * (tap a bar to pick it). Every figure is a published price guide passed in
 * from the server; the bars are only scaled against the commune's own
 * largest median, never smoothed or filled in.
 *
 * @param {{communes: {commune: string, label: string, rows: {beds: number, median: number, listings: number, slug: string}[]}[], note: string}} props
 */
// The tallest bar; the plot area (h-44) leaves room for the value above it.
const BAR_MAX_REM = 8.5;

function defaultBeds(rows) {
  return rows.reduce((best, row) => (row.listings > best.listings ? row : best), rows[0]).beds;
}

export default function HomeMarketExplorer({ communes, note }) {
  const t = useT();
  const [communeIndex, setCommuneIndex] = useState(0);
  const current = communes[communeIndex] || communes[0];
  const [bedsByCommune, setBedsByCommune] = useState({});
  const beds = bedsByCommune[current.commune] ?? defaultBeds(current.rows);
  const selected = current.rows.find((row) => row.beds === beds) || current.rows[0];
  const max = Math.max(1, ...current.rows.map((row) => row.median));

  return (
    // One column on a phone (communes, figure, chart, note); on a desktop the
    // panel has the whole width since the Lukka Index left, so the figure and
    // note sit left and the chart right rather than four very wide bars.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl bg-surface p-5 sm:p-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-14 lg:p-9">
      <div role="group" aria-label={t('home.market.communes')} className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 lg:col-start-1">
        {communes.map((entry, index) => {
          const on = index === communeIndex;
          return (
            <button
              key={entry.commune}
              type="button"
              aria-pressed={on}
              onClick={() => setCommuneIndex(index)}
              className={`u-press min-h-10 shrink-0 rounded-full px-4 text-[0.875rem] font-semibold transition-colors ${
                on ? 'bg-ink text-white' : 'bg-canvas-alt text-ink hover:bg-blue-tint'
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 lg:col-start-1" aria-live="polite">
        <p className="flex items-baseline gap-2">
          <span className="u-tabular text-[2.75rem] font-extrabold leading-none tracking-[-0.04em] text-ink sm:text-[3.5rem]">
            {frNumber(selected.median)} $
          </span>
          <span className="text-[1.0625rem] font-semibold text-ink-45">{t('home.prices.perMonth')}</span>
        </p>
        <p className="text-[0.9375rem] font-semibold text-ink">
          {t('home.market.statLabel', { count: selected.beds, commune: current.label })}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-45">
          <span>{t('home.market.statCount', { count: selected.listings })}</span>
          <Link href={`/combien-coute/${selected.slug}`} className="inline-flex items-center gap-1 font-semibold text-blue-deep hover:text-ink">
            {t('home.market.detail')}
            <ArrowRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </p>
      </div>

      <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-end">
        <div className="flex h-44 items-end gap-3 border-b border-line sm:gap-4">
          {current.rows.map((row) => {
            const on = row.beds === selected.beds;
            return (
              <button
                key={row.beds}
                type="button"
                aria-pressed={on}
                aria-label={t('home.market.barLabel', { count: row.beds, median: frNumber(row.median) })}
                onClick={() => setBedsByCommune((value) => ({ ...value, [current.commune]: row.beds }))}
                className="group flex h-full min-w-0 flex-1 flex-col items-stretch justify-end gap-1.5"
              >
                <span className={`u-tabular text-center text-[0.75rem] font-bold sm:text-[0.8125rem] ${on ? 'text-ink' : 'text-ink-45'}`}>
                  {frNumber(row.median)} $
                </span>
                <span
                  className={`block rounded-t-lg transition-[height,background-color] duration-300 ${on ? 'bg-blue-deep' : 'bg-blue-tint group-hover:bg-blue/25'}`}
                  style={{ height: `${Math.max(0.375, (row.median / max) * BAR_MAX_REM).toFixed(3)}rem` }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-3 sm:gap-4" aria-hidden="true">
          {current.rows.map((row) => (
            <span key={row.beds} className="min-w-0 flex-1 text-center text-[0.8125rem] font-semibold text-ink-45">
              {t('home.market.bedsShort', { count: row.beds })}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[0.75rem] leading-relaxed text-ink-45 lg:col-start-1 lg:self-end">{note}</p>
    </div>
  );
}
