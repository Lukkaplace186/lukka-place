import { frNumber } from '@/lib/format';
import { niceTicks } from '@/lib/niceTicks';

/**
 * The line chart of a live data block (components/blog/DataBlock.js): one
 * series, the median by month, a gap where a month had too few asks to
 * publish one. Pure SVG in the site's blue (currentColor), recessive grid,
 * the latest value labelled, each point a native tooltip on a hit target
 * wider than the mark. The block puts the same numbers in a hidden table.
 */

export const money = (value) => `${frNumber(value)} $`;

/** 'YYYY-MM' → "octobre 2026" / "oct. 26", in UTC so no timezone moves the month. */
export function monthLabel(month, locale, style = 'long') {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
    month: style === 'long' ? 'long' : 'short',
    year: style === 'long' ? 'numeric' : '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * The plot is an SVG stretched to the box (lines keep a 2px stroke through
 * vector-effect); every text and dot is HTML placed by percentage, so labels
 * stay at their real size on a 375px phone instead of shrinking with a
 * viewBox.
 */
export default function SeriesChart({ series, locale, valueLabel }) {
  const values = series.map((p) => p.median).filter((v) => v != null);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const xPct = (i) => (series.length === 1 ? 50 : 4 + (i * 92) / (series.length - 1));
  const yPct = (v) => (1 - (v - lo) / (hi - lo)) * 100;

  // Consecutive months with a median form one segment.
  const segments = [];
  let current = [];
  series.forEach((p, i) => {
    if (p.median == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(`${xPct(i).toFixed(2)},${yPct(p.median).toFixed(2)}`);
  });
  if (current.length) segments.push(current);
  const lastIndex = series.map((p) => p.median != null).lastIndexOf(true);
  // Month labels counted back from the latest: about 4 on a phone, 8 wider.
  const n = series.length;
  const phoneStep = Math.ceil(n / 4);
  const wideStep = Math.ceil(n / 8);
  const labelClass = (i) => {
    const back = n - 1 - i;
    if (back % phoneStep === 0) return '';
    return back % wideStep === 0 ? 'hidden sm:block' : null;
  };

  return (
    <div role="img" aria-label={valueLabel} className="flex gap-2 pt-3">
      <div className="relative h-44 w-14 shrink-0 sm:h-52" aria-hidden="true">
        {ticks.map((v) => (
          <span key={v} className="u-tabular absolute right-0 -translate-y-1/2 text-[11px] text-ink-45" style={{ top: `${yPct(v)}%` }}>
            {money(v)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1" aria-hidden="true">
        <div className="relative h-44 sm:h-52">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible text-blue">
            {ticks.map((v) => (
              <line key={v} x1="0" x2="100" y1={yPct(v)} y2={yPct(v)} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {segments.map((points, i) =>
              points.length > 1 ? (
                <polyline
                  key={i}
                  points={points.join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </svg>
          {series.map((p, i) =>
            p.median == null ? null : (
              <span
                key={p.month}
                title={`${monthLabel(p.month, locale)} : ${money(p.median)} (${p.sample})`}
                className="group absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{ left: `${xPct(i)}%`, top: `${yPct(p.median)}%` }}
              >
                <span className="size-2.5 rounded-full bg-blue ring-2 ring-surface transition-transform group-hover:scale-125" />
              </span>
            ),
          )}
          {lastIndex >= 0 ? (
            <span
              className="u-tabular absolute -translate-y-[170%] translate-x-[-100%] whitespace-nowrap rounded bg-surface/90 px-1 text-[12px] font-bold text-ink"
              style={{ left: `${xPct(lastIndex)}%`, top: `${yPct(series[lastIndex].median)}%` }}
            >
              {money(series[lastIndex].median)}
            </span>
          ) : null}
        </div>
        <div className="relative mt-2 h-4">
          {series.map((p, i) =>
            labelClass(i) === null ? null : (
              <span key={p.month} className={`absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-ink-45 ${labelClass(i)}`} style={{ left: `${xPct(i)}%` }}>
                {monthLabel(p.month, locale, 'short')}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
