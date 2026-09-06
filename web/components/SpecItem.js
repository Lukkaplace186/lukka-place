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
 * Label and value are the SAME colour (`--ink`, #0b1120) and the same
 * weight (500). They separate by size and casing alone — 10px uppercase
 * over 14px sentence case — not by going grey or going bold.
 *
 * That is a deliberate reversal of two earlier passes here. This rail was
 * 10px/800 ink-45 over 14px/800 ink, which came from an explicit
 * "Rightmove-chunky" brief; seen rendered at real card width it read as
 * heavy and busy, and the instruction that replaced it was to match a calm,
 * regular-weight reference. Weight is now the thing that does NOT vary
 * across the card, which is what makes it read quietly.
 *
 * Contrast is no longer a live concern here, which is why the computed
 * table that used to sit in this comment is gone: at #0b1120 on the card's
 * white `--surface` every label and value is 18.83:1, far above the 4.5:1
 * that applies to 10px text. The earlier greys were the risk (ink-35 was
 * 3.62:1 and failed); full ink cannot be.
 */
/**
 * The label and value treatments, exported as strings so the detail page's
 * KeyFacts grid renders its rail identically without re-typing the values.
 * KeyFacts can't just use <SpecCell> — it stacks an icon above the label,
 * a different structure — but the two rails must not drift apart in size,
 * weight, tracking or colour, which is exactly what happens when the same
 * treatment is written out at two call sites.
 */
export const SPEC_LABEL_CLASS =
  'text-[0.625rem] font-medium uppercase leading-none tracking-[0.09em] text-ink';
export const SPEC_VALUE_CLASS =
  'flex items-center gap-1.5 font-medium leading-none tracking-normal text-ink';

export function SpecCell({ label, children, className = '' }) {
  return (
    <span className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className={`truncate ${SPEC_LABEL_CLASS}`}>
        {label}
      </span>
      <span className={`text-[0.875rem] ${SPEC_VALUE_CLASS}`}>
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
        {Icon && <Icon strokeWidth={1.75} className="h-4 w-4 shrink-0" />}
        <span className="u-tabular">{spec.value}</span>
        {spec.key === 'area' ? <span className="font-medium">m²</span> : null}
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
