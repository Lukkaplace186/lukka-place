import { SPEC_ICONS } from './SpecIcons';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The full-word label for a spec key, for the stacked card grid. `specItems()`
 * (lib/listingView.js) carries only the terse inline form ("ch", "sdb", "m²")
 * because that is what a one-line spec row needs; a Rightmove-style label rail
 * wants the real word above the value, so the two vocabularies live side by
 * side rather than one being rewritten into the other.
 */
const SPEC_COLUMN_LABELS = {
  beds: 'Chambres',
  bath: 'Salles de bain',
  area: 'Surface',
  units: 'Portes',
};

/**
 * One column of the card's spec rail: a tiny uppercase label over its value.
 *
 * Exported so PropertyCard can render the property-type column ("Type de
 * bien" / "Appartement") through the exact same cell as the bed/bath/area
 * columns beside it — the label size, tracking, colour and the label→value
 * gap are then defined once here instead of being retyped at each call site
 * and drifting apart.
 *
 * `text-ink-45` for the label against `text-ink` (#0b1120) for the value:
 * the label is a wayfinding rail, the value is the data, and the step
 * between them is what makes the rail readable without competing.
 *
 * ink-45 (#5c6679) specifically, and this one is computed rather than
 * eyeballed — same discipline as the bronze/brass rule in web/CLAUDE.md.
 * Against the card's white `--surface`:
 *
 *     ink-35   #7c879c   3.62:1   fails AA
 *     slate-400 #94a3b8  2.56:1   fails AA  (the literal spec value)
 *     ink-45   #5c6679   5.78:1   passes AA
 *
 * The 4.5:1 threshold is the one that applies here: WCAG's relaxed 3:1
 * large-text allowance needs 18.66px bold or 24px regular, and this label is
 * 10px. A faint-grey micro-label is the single easiest place on a card to
 * fail contrast without anyone noticing, which is exactly why it is pinned
 * to a token that passes rather than to the lightest one that still "reads"
 * on a good monitor.
 */
export function SpecCell({ label, children, className = '' }) {
  return (
    <span className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="truncate text-[0.625rem] font-extrabold uppercase leading-none tracking-[0.09em] text-ink-45">
        {label}
      </span>
      <span className="flex items-center gap-1.5 text-[0.875rem] font-extrabold leading-none tracking-tight text-ink">
        {children}
      </span>
    </span>
  );
}

/**
 * One spec (`{key, value, label}` from lib/listingView.js's specItems()).
 *
 * `variant="inline"` (default) is the original icon + tabular number + terse
 * label on one line — still what the detail page's fact grid uses.
 *
 * `variant="stacked"` is the card's labelled column: "CHAMBRES" over "🛏 2".
 * The unit is dropped from the value there because the label already states
 * it — "CHAMBRES / 2 ch" says chambres twice, which is exactly the kind of
 * doubled copy this card has been stripped of everywhere else. `m²` is the
 * one exception and is kept, since "SURFACE / 140" without a unit is
 * genuinely ambiguous.
 */
export default function SpecItem({ spec, variant = 'inline' }) {
  const Icon = SPEC_ICONS[spec.key];

  if (variant === 'stacked') {
    return (
      <SpecCell label={SPEC_COLUMN_LABELS[spec.key] || spec.label}>
        {Icon && <Icon strokeWidth={2.25} className="h-4 w-4 shrink-0 text-ink-45" />}
        <span className="u-tabular">{spec.value}</span>
        {spec.key === 'area' ? <span className="font-bold text-ink-70">m²</span> : null}
      </SpecCell>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-ink-45" />}
      <span className="u-tabular font-semibold text-ink">{spec.value}</span> {spec.label}
    </span>
  );
}
