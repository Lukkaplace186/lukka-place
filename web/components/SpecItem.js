import { SPEC_ICONS } from './SpecIcons';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * One spec (`{key, value, label}` from lib/listingView.js's specItems())
 * rendered as an icon + tabular number + label — the same three-way layout
 * all three card designs need, pulled out once they all started using it
 * identically rather than left triplicated.
 */
export default function SpecItem({ spec }) {
  const Icon = SPEC_ICONS[spec.key];
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-ink-45" />}
      <span className="u-tabular font-semibold text-ink">{spec.value}</span> {spec.label}
    </span>
  );
}
