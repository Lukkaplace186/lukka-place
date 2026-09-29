import { changeText } from '@/lib/listingFunnel';

const count = (n) => Number(n).toLocaleString('fr-FR');

/**
 * The listing funnel as a list of bars — one row per step, the bar's length
 * relative to the widest step (views, in practice), the previous period on
 * the right when there is one. Presentational only: the caller passes rows
 * from lib/listingFunnel.js's funnelRows with labels already in the page's
 * language. A step whose value is unknown reads `unknownText`, never 0.
 *
 * @param {{rows: Array, previousLabel?: string|null, unknownText: string, sinceMark?: string}} props
 */
export default function ListingFunnel({ rows, previousLabel = null, unknownText, sinceMark = '' }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const change = previousLabel ? changeText(row.value, row.previous) : null;
        return (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[0.8125rem] text-ink-70">
                {row.label}
                {row.since && sinceMark ? <span className="text-ink-45"> {sinceMark}</span> : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="u-tabular text-[0.9375rem] font-bold text-ink">
                  {row.value == null ? <span className="text-[0.8125rem] font-normal text-ink-45">{unknownText}</span> : count(row.value)}
                </span>
                {previousLabel && row.previous != null ? (
                  <span className="u-tabular text-[0.75rem] text-ink-45" title={previousLabel}>
                    {change ? `${change} · ` : ''}{count(row.previous)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-alt" aria-hidden="true">
              <div className="h-full rounded-full bg-blue" style={{ width: `${Math.round(row.share * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
