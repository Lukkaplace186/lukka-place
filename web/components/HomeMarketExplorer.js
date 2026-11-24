'use client';

import { useState } from 'react';
import Link from '@/components/LocaleLink';
import { ArrowRight } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { frNumber } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The interactive part of HomeMarketBand: a commune picker, the median rent
 * of the picked bedroom count as the headline, the middle half of the asking
 * rents under it, and one bar per bedroom count (tap a bar to pick it). Every
 * figure is a published price guide passed in from the server; the bars are
 * only scaled against the commune's own largest median, never smoothed or
 * filled in.
 *
 * The headline links to the guide's own page ("Voir le détail") and runs
 * straight into the chart. A price-alert button, a "Voir les annonces à …"
 * button and a line about the alert sat between them for a day; they were
 * removed (owner, 2026-11-04) because the alert band above already offers
 * the alert, and the guide page carries the listings button.
 *
 * @param {{communes: {commune: string, label: string, rows: {beds: number, median: number, p25: number|null, p75: number|null, listings: number, lukkaListings: number, slug: string}[]}[], note: string}} props
 */

// The tallest bar; the plot area (h-36) leaves room for the value above it.
const BAR_MAX_REM = 6.5;

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
  const showRange = selected.p25 != null && selected.p75 != null && selected.p25 < selected.p75;

  return (
    // One column on a phone (communes, figure, chart, note). On a desktop the
    // communes run across the top and the chart sits right of the figure.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 rounded-2xl bg-surface p-4 sm:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-12 lg:p-7">
      <div
        role="group"
        aria-label={t('home.market.communes')}
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:col-span-2 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0"
      >
        {communes.map((entry, index) => {
          const on = index === communeIndex;
          return (
            <button
              key={entry.commune}
              type="button"
              aria-pressed={on}
              onClick={() => setCommuneIndex(index)}
              className={`u-press min-h-9 shrink-0 rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors ${
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
          <span className="u-tabular text-[1.875rem] font-extrabold leading-none tracking-[-0.03em] text-ink sm:text-[2.5rem]">
            {frNumber(selected.median)} $
          </span>
          <span className="text-[0.9375rem] font-semibold text-ink-45 sm:text-[1rem]">{t('home.prices.perMonth')}</span>
        </p>
        <p className="text-[0.9375rem] font-semibold text-ink">
          {t('home.market.statLabel', { count: selected.beds, commune: current.label })}
        </p>
        {showRange ? (
          <p className="text-[0.875rem] text-ink-70">
            {t('home.prices.range', { p25: frNumber(selected.p25), p75: frNumber(selected.p75) })}
          </p>
        ) : null}
        {/* No listing counts on the card (owner, 2026-11-04); the guide page
            behind "Voir le détail" still states them. */}
        <Link
          href={`/combien-coute/${selected.slug}`}
          className="inline-flex items-center gap-1 self-start text-[0.8125rem] font-semibold text-blue-deep hover:text-ink"
        >
          {t('home.market.detail')}
          <ArrowRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:self-end">
        <div className="flex h-36 items-end justify-around gap-3 border-b border-line sm:gap-4">
          {current.rows.map((row) => {
            const on = row.beds === selected.beds;
            return (
              <button
                key={row.beds}
                type="button"
                aria-pressed={on}
                aria-label={t('home.market.barLabel', { count: row.beds, median: frNumber(row.median) })}
                onClick={() => setBedsByCommune((value) => ({ ...value, [current.commune]: row.beds }))}
                className="group flex h-full min-w-0 max-w-32 flex-1 flex-col items-stretch justify-end gap-1.5"
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
        <div className="mt-2 flex justify-around gap-3 sm:gap-4" aria-hidden="true">
          {current.rows.map((row) => (
            <span key={row.beds} className="min-w-0 max-w-32 flex-1 text-center text-[0.8125rem] font-semibold text-ink-45">
              {t('home.market.bedsShort', { count: row.beds })}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[0.75rem] leading-relaxed text-ink-45 lg:col-start-1 lg:self-end">{note}</p>
    </div>
  );
}
