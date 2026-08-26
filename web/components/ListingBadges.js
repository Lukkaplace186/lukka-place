import {
  Camera, Zap, Sun, Droplet, Route, ShieldCheck, Car, Snowflake, Sofa,
} from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The chip vocabulary shared by all three card designs.
 *
 * Every badge here is backed by real data. The reference portals lean
 * heavily on engagement hooks ("Price cut", "769 days on Zillow", "Complex
 * has a pool") — none of those are reproducible here: there is no price
 * history, and no structured amenity column, only the commune tag. Inventing
 * a flag would break CLAUDE.md's no-fabricated-data rule, so `AmenityPill`
 * below renders only keys `lib/listingView.js`'s `matchedAmenityKeys` found
 * as a real word-boundary match in the listing's own title/description —
 * the same text-matching honesty posture the "Plus de filtres" checkboxes
 * already use server-side (`lib/listings.js`'s `buildFilters`), just
 * surfaced as a badge instead of a filter.
 */

export function TypeBadge({ children }) {
  if (!children) return null;
  return (
    <span className="u-glass-royal pointer-events-none rounded-full px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
      {children}
    </span>
  );
}

export function PhotoCountBadge({ count }) {
  if (!count || count < 1) return null;
  return (
    <span className="u-glass-royal pointer-events-none inline-flex items-center gap-1 rounded-full px-2 py-1 text-[0.6875rem] font-medium">
      <Camera strokeWidth={2} className="h-3 w-3" />
      {count}
    </span>
  );
}

/**
 * properties.listing_status (Phase 4B) — a real sales-lifecycle flag an
 * agent sets themselves from their own dashboard, separate from
 * approve_status (moderation). Renders nothing for 'active', the default
 * and by far the common case — a badge on every single card would be noise,
 * not signal.
 */
const LISTING_STATUS_LABELS = { under_offer: 'Sous compromis', closed: 'Loué / Vendu' };

export function ListingStatusBadge({ status }) {
  const label = LISTING_STATUS_LABELS[status];
  if (!label) return null;
  return (
    <span className="pointer-events-none rounded-full bg-ink px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white">
      {label}
    </span>
  );
}

/** Rental listings only — flags the income framing an investor is scanning for. */
export function RentBadge() {
  return (
    <span className="rounded-full bg-green-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-green-deep">
      Location
    </span>
  );
}

/**
 * Dead until the `deposit_months` column exists on live Supabase — see the
 * TODO in lib/listings.js. Rendered only when the value is genuinely
 * present, so it stays invisible rather than showing a guessed number.
 */
export function DepositBadge({ months }) {
  if (months == null) return null;
  return (
    <span className="rounded-full border border-blue/30 bg-blue-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-blue-deep">
      Garantie {months} mois
    </span>
  );
}

/**
 * Icon + short label per AMENITY_KEYWORDS key (lib/constants.js) — a
 * compact pill vocabulary for `AmenityPill` below. Short forms ("Groupe",
 * not the filter drawer's full "Groupe électrogène"): these sit over a card
 * photo, not in a checkbox list, so brevity matters more than completeness.
 */
const AMENITY_PILL_META = {
  generator: { icon: Zap, label: 'Groupe' },
  solar: { icon: Sun, label: 'Solaire' },
  borehole: { icon: Droplet, label: 'Forage' },
  paved_road: { icon: Route, label: 'Route' },
  security: { icon: ShieldCheck, label: 'Sécurisé' },
  parking: { icon: Car, label: 'Parking' },
  ac: { icon: Snowflake, label: 'Climatisé' },
  furnished: { icon: Sofa, label: 'Meublé' },
};

/**
 * One real, text-matched amenity badge (see lib/listingView.js's
 * matchedAmenityKeys) — for an unrecognised key (shouldn't happen, since
 * callers always derive keys from that same function) renders nothing
 * rather than a broken pill.
 */
export function AmenityPill({ amenityKey }) {
  const meta = AMENITY_PILL_META[amenityKey];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className="u-glass-royal pointer-events-none inline-flex items-center gap-1 rounded-full px-2 py-1 text-[0.6875rem] font-medium">
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
