import { Suspense } from 'react';
import AgentChartRangeSelect from './AgentChartRangeSelect';

/**
 * The design's "Vues de vos annonces" card: title over a caption, the range
 * Select right-aligned, then a 220px bar plot whose bars carry their value
 * as a label above them and their period label below the baseline rule.
 *
 * Bars are scaled against the real maximum in the window (not the design's
 * hardcoded 1500), with a floor of 1 so a single-view day still draws a
 * visible bar instead of a hairline. A bucket with genuinely zero views
 * draws no bar at all and keeps its label — the honest shape of a quiet
 * period, which is exactly what this chart is for.
 */
export default function AgentViewsChart({ series, rangeOptions, range, rangeLabel }) {
  const max = Math.max(1, ...series.map((b) => b.views));
  const hasAny = series.some((b) => b.views > 0);

  return (
    <div className="u-card rounded-card bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[1.125rem] font-bold text-ink">Vues de vos annonces</h2>
          <p className="mt-0.5 text-[0.8125rem] text-ink-45">{rangeLabel}</p>
        </div>
        <Suspense fallback={<div className="h-10 w-[9.5rem] rounded-lg border border-line bg-surface" />}>
          <AgentChartRangeSelect options={rangeOptions} value={range} />
        </Suspense>
      </div>

      {hasAny ? (
        <>
          <div className="mt-7 flex h-[13.75rem] items-end gap-2 border-b border-line pt-3 sm:gap-[1.125rem]">
            {series.map((b) => (
              <div key={b.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <span className="u-tabular text-xs font-bold text-ink">{b.views.toLocaleString('fr-FR')}</span>
                <div
                  className="w-full rounded-t-lg bg-blue"
                  style={{ height: `${Math.max((b.views / max) * 100, b.views > 0 ? 3 : 0)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex gap-2 sm:gap-[1.125rem]">
            {series.map((b) => (
              <div key={b.key} className="flex-1 text-center text-xs capitalize text-ink-45">
                {b.label}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-7 flex h-[13.75rem] items-center justify-center border-b border-line text-sm text-ink-45">
          Pas encore de vues sur cette période.
        </div>
      )}
    </div>
  );
}
