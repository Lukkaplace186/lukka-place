import Link from 'next/link';
import { X } from 'lucide-react';
import { AMENITY_GROUPS, DEPOSIT_MAX_OPTIONS, ICON_STROKE_WIDTH } from '@/lib/constants';
import { hrefWithoutKeys, hrefWithoutAmenity } from '@/lib/urlParams';

const AMENITY_LABELS = Object.fromEntries(AMENITY_GROUPS.flatMap((g) => g.options).map(({ key, label }) => [key, label]));
const KM_RADIUS_VALUES = new Set(['1', '3', '5']);

/**
 * One removable chip per active filter, real query-param-driven (same
 * `params` shape/hrefWithoutKeys helper ListingsEmptyState.js's own
 * relaxation links already use) — not a duplicate of FilterBar.js's own
 * pill state, just a second, glanceable view of the same URL truth. A
 * chip's "x" always preserves every *other* active filter, including ones
 * that need to cascade (removing the location chip also clears quartier
 * and radius — a radius/quartier with no commune left is meaningless;
 * removing property type also clears parcelle_subtype the same way).
 *
 * Renders nothing when no filter is active — this is a summary of what's
 * currently applied, not a permanent UI fixture.
 */
export default function ActiveFilterChips({ params = {}, propertyTypeLabel }) {
  const chips = [];

  if (params.transaction_type) {
    chips.push({
      key: 'transaction_type',
      label: params.transaction_type === 'location' ? 'À louer' : 'À vendre',
      href: hrefWithoutKeys(params, 'transaction_type'),
    });
  }

  if (params.quartier) {
    chips.push({ key: 'quartier', label: params.quartier, href: hrefWithoutKeys(params, ['quartier', 'radius']) });
  } else if (params.commune) {
    chips.push({ key: 'commune', label: params.commune, href: hrefWithoutKeys(params, ['commune', 'quartier', 'radius']) });
  }

  if (params.commune && params.radius) {
    const radiusLabel = KM_RADIUS_VALUES.has(params.radius)
      ? `+${params.radius} km`
      : params.radius === 'commune'
        ? 'Toute la commune'
        : params.radius === 'citywide'
          ? 'Toute la ville'
          : null;
    if (radiusLabel) chips.push({ key: 'radius', label: radiusLabel, href: hrefWithoutKeys(params, 'radius') });
  }

  if (params.property_type) {
    chips.push({
      key: 'property_type',
      label: propertyTypeLabel || params.property_type,
      href: hrefWithoutKeys(params, ['property_type', 'parcelle_subtype']),
    });
  }

  if (params.price_min || params.price_max) {
    const label =
      params.price_min && params.price_max
        ? `${params.price_min}$ - ${params.price_max}$`
        : params.price_min
          ? `Dès ${params.price_min}$`
          : `Max ${params.price_max}$`;
    chips.push({ key: 'price', label, href: hrefWithoutKeys(params, ['price_min', 'price_max']) });
  }

  if (params.beds_min) {
    chips.push({ key: 'beds_min', label: `${params.beds_min}+ chambres`, href: hrefWithoutKeys(params, 'beds_min') });
  }
  if (params.bath_min) {
    chips.push({ key: 'bath_min', label: `${params.bath_min}+ sdb`, href: hrefWithoutKeys(params, 'bath_min') });
  }

  if (params.deposit_max) {
    const option = DEPOSIT_MAX_OPTIONS.find((o) => o.value === params.deposit_max);
    chips.push({
      key: 'deposit_max',
      label: `Garantie ≤ ${option?.label || `${params.deposit_max} mois`}`,
      href: hrefWithoutKeys(params, 'deposit_max'),
    });
  }

  const activeAmenities = params.amenities ? params.amenities.split(',').filter(Boolean) : [];
  for (const amenityKey of activeAmenities) {
    const label = AMENITY_LABELS[amenityKey];
    if (!label) continue; // unrecognised/stale key in a hand-edited URL — never render a chip for it
    chips.push({ key: `amenity-${amenityKey}`, label, href: hrefWithoutAmenity(params, amenityKey) });
  }

  if (params.q) {
    chips.push({ key: 'q', label: `« ${params.q} »`, href: hrefWithoutKeys(params, 'q') });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 pb-3 pt-2 sm:px-6 lg:px-8">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="u-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[0.75rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
        >
          {chip.label}
          <X strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
        </Link>
      ))}
      {chips.length > 1 ? (
        <Link
          href="/listings"
          className="text-[0.75rem] font-medium text-ink-45 underline-offset-2 transition-colors hover:text-blue-deep hover:underline"
        >
          Tout effacer
        </Link>
      ) : null}
    </div>
  );
}
