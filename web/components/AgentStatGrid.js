import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The design's stat strip: ONE white card at card radius with shadow-xs,
 * split into cells by hairline dividers — not a row of separate bordered
 * boxes. Each cell is label / big tabular value / delta on the left, with a
 * 44px royal-50 icon disc on the right.
 *
 * The design shows four cells with deltas like "+18 %". Six real metrics
 * exist here, so the grid carries six and reflows (2 / 3 / 6) instead of
 * dropping two real numbers to match a sample layout.
 *
 * Deltas are real month-over-month movement (lib/analytics.js's
 * getAgentMonthlyDeltas) and a cell simply renders none when there is no
 * honest one to show — a metric with no prior month to compare against
 * gets nothing rather than a fabricated "+100 %". Sign drives the colour:
 * the design's green is only correct for a rise.
 *
 * A stat carrying an `href` renders as a real link into the list its number
 * came from, so the strip is a navigation surface rather than a read-only
 * scoreboard. One without an href stays a plain cell — the affordance
 * (hover fill + corner arrow) only ever appears where there is genuinely
 * somewhere to go.
 */
function DeltaLine({ delta }) {
  if (delta == null) return null;

  if (delta.kind === 'count') {
    if (!delta.value) return null;
    return (
      <div className="mt-1 text-xs font-semibold text-success">
        +{delta.value.toLocaleString('fr-FR')} ce mois
      </div>
    );
  }

  // `null` means there was no previous month to compare against, so there is
  // no honest percentage to show — getAgentMonthlyDeltas returns it rather
  // than inventing a "+100 %" out of a zero baseline. This has to be checked
  // BEFORE the numeric branches: `null === 0` is false and `Math.abs(null)`
  // is 0, so falling through renders a nonsensical "−0 %".
  if (delta.value == null) return null;

  if (delta.value === 0) {
    return <div className="mt-1 text-xs font-semibold text-ink-35">stable ce mois</div>;
  }
  const up = delta.value > 0;
  return (
    <div className={`mt-1 text-xs font-semibold ${up ? 'text-success' : 'text-danger'}`}>
      {up ? '+' : '−'}
      {Math.abs(delta.value)} % ce mois
    </div>
  );
}

function StatBody({ stat }) {
  return (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[0.8125rem] text-ink-45">
          <span className="truncate">{stat.label}</span>
          {stat.href && (
            <ArrowUpRight
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-ink-25 opacity-0 transition-opacity group-hover:opacity-100"
            />
          )}
        </div>
        <div className="u-stat mt-1.5 text-ink">
          {stat.value.toLocaleString('fr-FR')}
        </div>
        <DeltaLine delta={stat.delta} />
      </div>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-tint text-blue">
        <stat.icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </div>
    </>
  );
}

const CELL_CLASS = 'flex items-center justify-between gap-3 bg-surface px-5 py-[1.375rem]';

export default function AgentStatGrid({ stats }) {
  return (
    // gap-px over a --line background paints the design's hairline dividers
    // between cells at every breakpoint, without nth-child variants that
    // Tailwind can silently fail to generate (see web/CLAUDE.md).
    <div className="u-card grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line lg:grid-cols-4">
      {stats.map((stat) =>
        stat.href ? (
          <Link
            key={stat.key}
            href={stat.href}
            className={`${CELL_CLASS} group u-press text-left transition-colors hover:bg-canvas-alt`}
          >
            <StatBody stat={stat} />
          </Link>
        ) : (
          <div key={stat.key} className={CELL_CLASS}>
            <StatBody stat={stat} />
          </div>
        ),
      )}
    </div>
  );
}
