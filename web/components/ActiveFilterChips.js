import Link from 'next/link';
import { X } from 'lucide-react';
import { AMENITY_GROUPS, DEPOSIT_MAX_OPTIONS, ICON_STROKE_WIDTH } from '@/lib/constants';
import { hrefWithoutKeys, hrefWithoutAmenity } from '@/lib/urlParams';
import { getT } from '@/lib/i18n/server';

const AMENITY_LABEL_KEYS = Object.fromEntries(
  AMENITY_GROUPS.flatMap((g) => g.options).map(({ key, labelKey }) => [key, labelKey]),
);
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
// Async so it can `await getT()` — it stays a Server Component (it renders
// only <Link>s, no interactivity) rather than being pushed into the client
// bundle just to read the locale.
export default async function ActiveFilterChips({ params = {}, propertyTypeLabel }) {
  const t = await getT();
  const chips = [];

  if (params.transaction_type) {
    chips.push({
      key: 'transaction_type',
      label: params.transaction_type === 'location' ? t('listings.transaction.rent') : t('listings.transaction.sale'),
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
      ? t('listings.chips.radiusKm', { km: params.radius })
      : params.radius === 'commune'
        ? t('listings.chips.wholeCommune')
        : params.radius === 'citywide'
          ? t('listings.chips.citywide')
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
        ? t('listings.chips.priceRange', { min: params.price_min, max: params.price_max })
        : params.price_min
          ? t('listings.chips.priceFrom', { min: params.price_min })
          : t('listings.chips.priceUpTo', { max: params.price_max });
    chips.push({ key: 'price', label, href: hrefWithoutKeys(params, ['price_min', 'price_max']) });
  }

  if (params.beds_min) {
    chips.push({
      key: 'beds_min',
      label: t('listings.filters.bedsChip', { count: params.beds_min }),
      href: hrefWithoutKeys(params, 'beds_min'),
    });
  }
  if (params.bath_min) {
    chips.push({
      key: 'bath_min',
      label: t('listings.filters.bathChip', { count: params.bath_min }),
      href: hrefWithoutKeys(params, 'bath_min'),
    });
  }

  if (params.deposit_max) {
    const option = DEPOSIT_MAX_OPTIONS.find((o) => o.value === params.deposit_max);
    chips.push({
      key: 'deposit_max',
      label: t('listings.filters.depositMax', {
        value: option ? t(option.labelKey) : t('listings.depositMax.months', { count: params.deposit_max }),
      }),
      href: hrefWithoutKeys(params, 'deposit_max'),
    });
  }

  const activeAmenities = params.amenities ? params.amenities.split(',').filter(Boolean) : [];
  for (const amenityKey of activeAmenities) {
    const labelKey = AMENITY_LABEL_KEYS[amenityKey];
    if (!labelKey) continue; // unrecognised/stale key in a hand-edited URL — never render a chip for it
    chips.push({ key: `amenity-${amenityKey}`, label: t(labelKey), href: hrefWithoutAmenity(params, amenityKey) });
  }

  if (params.q) {
    chips.push({ key: 'q', label: t('listings.filters.queryChip', { query: params.q }), href: hrefWithoutKeys(params, 'q') });
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
          {t('listings.filters.clearAll')}
        </Link>
      ) : null}
    </div>
  );
}
