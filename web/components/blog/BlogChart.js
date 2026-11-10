import Link from '@/components/LocaleLink';
import { frNumber } from '@/lib/format';

/**
 * A post's chart (`:::graphique`, lib/blogRules.js), drawn on the server
 * with no chart library: horizontal bars in HTML (long commune names wrap,
 * nothing to measure) and lines in SVG. The axis always starts at zero, so a
 * bar's length is honest. Motion is CSS on [data-reveal] (bars grow, lines
 * draw), played by the enclosing <Reveal>.
 */
const SERIES = ['var(--blue)', 'var(--brass)', 'var(--green)'];

function fmt(value, unit) {
  const n = frNumber(value, { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 });
  if (!unit) return n;
  return unit === '%' ? `${n} %` : `${n} ${unit}`;
}

function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <ul className="u-micro flex flex-wrap gap-x-4 gap-y-1 text-ink-70">
      {series.map((name, i) => (
        <li key={name} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: SERIES[i] }} />
          {name}
        </li>
      ))}
    </ul>
  );
}

function Bars({ chart }) {
  const max = Math.max(...chart.points.flatMap((p) => p.values), 0) || 1;
  return (
    <ul className="flex flex-col gap-3">
      {chart.points.map((point, row) => (
        <li key={`${point.label}-${row}`} className="grid gap-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-center sm:gap-3">
          <span className="u-micro-strong truncate text-ink" title={point.label}>
            {point.href ? <Link href={point.href} className="hover:underline">{point.label}</Link> : point.label}
          </span>
          <span className="flex flex-col gap-1">
            {point.values.map((value, i) => (
              <span key={i} className="flex items-center gap-2">
                <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-canvas-alt">
                  <span
                    className="u-bar block h-full rounded-full"
                    style={{ width: `${Math.max(0, (value / max) * 100)}%`, background: SERIES[i], '--i': row }}
                  />
                </span>
                <span className="u-micro u-tabular w-16 shrink-0 text-right text-ink-70">{fmt(value, chart.unit)}</span>
              </span>
            ))}
            {point.note ? <span className="u-micro text-ink-45">{point.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const W = 640;
const H = 280;
const PAD = { top: 18, right: 18, bottom: 34, left: 56 };

/** 0 → a round top above max, in 4 steps. */
function niceTicks(max) {
  const raw = max / 4 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

function Lines({ chart }) {
  const ticks = niceTicks(Math.max(...chart.points.flatMap((p) => p.values), 0));
  const top = ticks[ticks.length - 1] || 1;
  const n = chart.points.length;
  const x = (i) => PAD.left + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (v) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const every = Math.ceil(n / 8);
  const seriesCount = chart.points[0].values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={chart.title || undefined}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--ink-45)">
            {frNumber(t)}
          </text>
        </g>
      ))}
      {chart.points.map((p, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={`${p.label}-${i}`} x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="12" fill="var(--ink-70)">
            {p.label}
          </text>
        ) : null,
      )}
      {Array.from({ length: seriesCount }, (_, s) => (
        <g key={s}>
          <polyline
            className="u-line"
            pathLength="1"
            fill="none"
            stroke={SERIES[s]}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={chart.points.map((p, i) => `${x(i)},${y(p.values[s])}`).join(' ')}
          />
          {chart.points.map((p, i) => (
            <circle key={i} className="u-dot" cx={x(i)} cy={y(p.values[s])} r="4" fill="var(--surface)" stroke={SERIES[s]} strokeWidth="2">
              <title>{`${p.label} : ${fmt(p.values[s], chart.unit)}`}</title>
            </circle>
          ))}
          <text x={x(n - 1)} y={y(chart.points[n - 1].values[s]) - 10} textAnchor="end" fontSize="12" fontWeight="700" fill={SERIES[s]}>
            {fmt(chart.points[n - 1].values[s], chart.unit)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Also used by the live price block, which passes `points` with links and notes. */
export default function BlogChart({ chart, caption }) {
  return (
    <figure className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)] sm:p-6">
      {chart.title ? <figcaption className="u-title-card text-ink">{chart.title}</figcaption> : null}
      <Legend series={chart.series || []} />
      {chart.kind === 'line' ? <Lines chart={chart} /> : <Bars chart={chart} />}
      {caption ? <p className="u-micro text-ink-45">{caption}</p> : null}
    </figure>
  );
}
