import Link from 'next/link';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import TrendChip from './TrendChip';

/**
 * The overview's four figures, as a 2×2 grid of tappable cards on a phone and
 * one row of four from `lg` (2026-10-05 redesign).
 *
 * Each card: an icon + label, the big tabular value, then a foot row holding
 * the trend chip and an optional one-line fact ("dont 1 sous offre"). Every
 * trend compares the same window as its figure — the last 30 days against
 * the 30 before (lib/analytics.js getAgentWindowStats) — and the page says so
 * once above the grid instead of "ce mois" under every number.
 *
 * `delta`:
 *   { kind: 'pct', value }   a percentage; null renders nothing (no honest
 *                            change from a zero baseline, see trendPercent)
 *   { kind: 'count', value } a signed count ("+2")
 * Sign drives colour: green for a rise, red for a fall, grey for no change.
 *
 * A stat with an `href` is a link into the list its number came from.
 */
function StatBody({ stat }) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold leading-tight text-ink-45">
        <stat.icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-blue" aria-hidden="true" />
        <span className="min-w-0 truncate">{stat.label}</span>
      </span>
      {/* null = the source could not answer (the engine is down): a dash,
          never a 0 that reads as "nobody asked". */}
      <span className="u-stat mt-1.5 block text-ink">{stat.value == null ? '—' : stat.value.toLocaleString('fr-FR')}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-xs text-ink-45">
        <TrendChip delta={stat.delta} />
        {stat.foot && <span className="min-w-0">{stat.foot}</span>}
      </span>
    </>
  );
}

const CARD_CLASS = 'u-card flex min-h-[7.5rem] flex-col rounded-card bg-surface p-3.5 text-left sm:p-5';

export default function AgentStatGrid({ stats, caption }) {
  return (
    <section aria-label={caption || undefined}>
      {caption && <p className="u-micro mb-2 text-ink-45">{caption}</p>}
      <div className="u-stagger grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        {stats.map((stat) =>
          stat.href ? (
            <Link key={stat.key} href={stat.href} className={`${CARD_CLASS} u-press transition-shadow hover:shadow-md`}>
              <StatBody stat={stat} />
            </Link>
          ) : (
            <div key={stat.key} className={CARD_CLASS}>
              <StatBody stat={stat} />
            </div>
          ),
        )}
      </div>
    </section>
  );
}
