import { Suspense } from 'react';
import AgentChartRangeSelect from './AgentChartRangeSelect';
import { getT } from '@/lib/i18n/server';

/**
 * Views of the agent's listings: title, the range select, the window's total
 * (with its trend when the caller has one), then the bars.
 *
 * The total is the sum of the bars drawn, so it can never disagree with them;
 * on the overview the 30-day series covers exactly getAgentWindowStats'
 * window, so it also equals the "Vues" figure above (2026-10-05).
 *
 * Up to 12 bars carry their value and their own label. A dense series (30
 * days) would be unreadable that way on a phone, so its bars carry the date
 * and count as a tooltip / accessible name, and only the two ends are
 * labelled under the axis.
 *
 * Bars scale against the real maximum, with a floor so a 1-view day is still
 * visible; a day with no views draws no bar.
 */
export default async function AgentViewsChart({ series, rangeOptions, range, rangeLabel, trend = null }) {
  const t = await getT();
  const max = Math.max(1, ...series.map((b) => b.views));
  const total = series.reduce((sum, b) => sum + b.views, 0);
  const hasAny = total > 0;
  const dense = series.length > 12;

  return (
    <section className="u-card rounded-card bg-surface p-4 sm:p-6" aria-labelledby="agent-views-chart-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="agent-views-chart-title" className="u-title-card text-ink">{t('agent.overview.viewsChart')}</h2>
          <p className="mt-0.5 text-[0.8125rem] text-ink-45">{rangeLabel}</p>
        </div>
        <Suspense fallback={<div className="h-10 w-[9.5rem] rounded-lg border border-line bg-surface" />}>
          <AgentChartRangeSelect options={rangeOptions} value={range} />
        </Suspense>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="u-tabular text-[1.625rem] font-extrabold leading-none tracking-tight text-ink">
          {total.toLocaleString('fr-FR')}
        </span>
        <span className="u-micro text-ink-45">{t('agent.overview.viewsUnit', { count: total })}</span>
        {trend}
      </div>

      {hasAny ? (
        <>
          <div
            className={`mt-4 flex h-[10rem] items-end border-b border-line sm:h-[12.5rem] ${dense ? 'gap-[2px] sm:gap-1' : 'gap-2 pt-5 sm:gap-[1.125rem]'}`}
            role="img"
            aria-label={`${t('agent.overview.viewsChart')} — ${rangeLabel} : ${total.toLocaleString('fr-FR')}`}
          >
            {series.map((b) => (
              <div key={b.key} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                {!dense && <span className="u-tabular text-xs font-bold text-ink">{b.views.toLocaleString('fr-FR')}</span>}
                <div
                  className={`w-full bg-blue transition-opacity group-hover:opacity-80 ${dense ? 'rounded-t-[3px]' : 'rounded-t-lg'}`}
                  style={{ height: `${Math.max((b.views / max) * 100, b.views > 0 ? 3 : 0)}%` }}
                  title={`${b.fullLabel || b.label} · ${b.views.toLocaleString('fr-FR')}`}
                />
              </div>
            ))}
          </div>
          {dense ? (
            <div className="mt-2 flex justify-between text-xs text-ink-45">
              <span>{series[0].fullLabel || series[0].label}</span>
              <span>{series[series.length - 1].fullLabel || series[series.length - 1].label}</span>
            </div>
          ) : (
            <div className="mt-2.5 flex gap-2 sm:gap-[1.125rem]">
              {series.map((b) => (
                <div key={b.key} className="min-w-0 flex-1 truncate text-center text-xs capitalize text-ink-45">
                  {b.label}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 flex h-[10rem] items-center justify-center border-b border-line text-sm text-ink-45 sm:h-[12.5rem]">
          {t('agent.editor.noViewsInPeriod')}
        </div>
      )}
    </section>
  );
}
