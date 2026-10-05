import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * A trend pill: "+12 %" green, "−18 %" red, "0 %" grey; a `count` delta reads
 * "+2". Nothing renders for a null value — lib/analytics.js trendPercent
 * returns null when there is no honest change to show.
 */
export default function TrendChip({ delta }) {
  if (!delta || delta.value == null || !Number.isFinite(delta.value)) return null;
  const { kind, value } = delta;
  if (kind === 'count' && value === 0) return null;
  const up = value > 0;
  const flat = value === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const text = kind === 'pct' ? `${up ? '+' : flat ? '' : '−'}${Math.abs(value)} %` : `${up ? '+' : '−'}${Math.abs(value)}`;
  return (
    <span
      className={`u-tabular inline-flex h-[1.375rem] items-center gap-1 rounded-full px-2 text-xs font-extrabold ${
        flat ? 'bg-canvas-deep text-ink-70' : up ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'
      }`}
    >
      <Icon strokeWidth={2.25} className="h-3.5 w-3.5" aria-hidden="true" />
      {text}
    </span>
  );
}
