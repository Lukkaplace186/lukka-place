import { Camera } from 'lucide-react';

/**
 * The chip vocabulary shared by all three card designs.
 *
 * Every badge here is backed by a real column. The reference portals lean
 * heavily on engagement hooks ("Price cut", "769 days on Zillow", "Complex
 * has a pool") — none of those are reproducible here: there is no price
 * history, and no amenity data beyond the commune tag. Inventing them would
 * break CLAUDE.md's no-fabricated-data rule, so the set below is limited to
 * what the data can actually prove.
 */

export function NewBadge() {
  return (
    <span className="pointer-events-none rounded-full bg-blue px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-white">
      Nouveau
    </span>
  );
}

export function TypeBadge({ children }) {
  if (!children) return null;
  return (
    <span className="pointer-events-none rounded-full bg-ink/60 px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white backdrop-blur-md">
      {children}
    </span>
  );
}

export function PhotoCountBadge({ count }) {
  if (!count || count < 1) return null;
  return (
    <span className="pointer-events-none inline-flex items-center gap-1 rounded-full bg-ink/60 px-2 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-md">
      <Camera strokeWidth={2} className="h-3 w-3" />
      {count}
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
