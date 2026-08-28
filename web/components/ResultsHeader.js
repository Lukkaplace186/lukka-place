import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import SortDropdown from './SortDropdown';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Results header — breadcrumb, real result count and sort, following the
 * reference (Rightmove puts exactly this row above its results and it is
 * the clearest orientation device on the page).
 *
 * The heading is built from the filters actually applied, never a static or
 * invented location. SaveSearchButton now lives in FilterBar.js instead, at
 * the end of the toolbar to match Zoopla's own layout — it's `type="button"`
 * there so it still can't trigger the surrounding filter form's submit.
 */
function buildHeading({ commune, quartier, transactionType, propertyTypeLabel, citywide, communeWide }) {
  const subject = propertyTypeLabel || 'Biens';
  const place = citywide ? 'Kinshasa' : communeWide ? commune : quartier || commune || 'Kinshasa';
  const label = transactionType === 'location' ? 'à louer' : transactionType === 'vente' ? 'à vendre' : 'disponibles';
  return `${subject} ${label} à ${place}`;
}

export default function ResultsHeader({
  total,
  commune,
  quartier,
  transactionType,
  propertyTypeLabel,
  locationRelaxed = false,
  relaxedFromCommune = null,
  // FilterBar.js's "Rayon" dropdown — commune/quartier are still selected
  // (the pill/breadcrumb should keep showing them as the search's starting
  // point) but the query itself no longer filters on one or both of them, so
  // the heading and result count must say so, not silently keep claiming
  // "à {quartier}" for a result set that's actually commune- or city-wide.
  citywide = false,
  communeWide = false,
  // Km-radius auto-expand ladder (getListings()'s RADIUS_LADDER, lib/
  // listings.js): fires only when the visitor explicitly picked a narrow km
  // tier on FilterBar.js's Rayon pill and it returned zero results.
  // requestedRadius keeps matching what the pill itself still shows
  // ("+1 km") — this caption is what makes the wider data honest instead of
  // silently mixing distances.
  radiusExpanded = false,
  requestedRadius = null,
  effectiveRadius = null,
}) {
  const heading = buildHeading({ commune, quartier, transactionType, propertyTypeLabel, citywide, communeWide });

  const crumbs = [{ label: 'Accueil', href: '/' }, { label: 'Annonces', href: '/listings' }];
  if (commune) crumbs.push({ label: commune, href: `/listings?commune=${encodeURIComponent(commune)}` });

  return (
    // mb-2, not the previous mb-5, below lg — "tight top block, first card
    // visible on initial load" instruction. lg:mb-5 keeps desktop as it
    // was, matching the breadcrumb's own lg: reveal breakpoint just below
    // so the two never fall out of step (a value that switched at a
    // different breakpoint than the nav it's spacing would leave a stretch
    // of viewport widths with the old margin but no breadcrumb to justify
    // it, or vice versa).
    <div className="mb-2 lg:mb-5">
      {/* hidden lg:flex — the breadcrumb is real navigation (Accueil >
          Annonces > commune), not decoration, but it's also the first
          thing eating vertical space above the feed on a phone, per an
          explicit "no breadcrumb on mobile" instruction. Desktop keeps it,
          unchanged. */}
      <nav aria-label="Fil d'Ariane" className="mb-4 hidden flex-wrap items-center gap-1 text-[0.75rem] text-ink-45 lg:flex">
        {crumbs.map(({ label, href }, i) => (
          <span key={href} className="inline-flex items-center gap-1">
            {i > 0 ? (
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-3 w-3 text-ink-25" />
            ) : null}
            {i === crumbs.length - 1 ? (
              <span className="text-ink-70">{label}</span>
            ) : (
              <Link href={href} className="transition-colors hover:text-blue-deep">
                {label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* Sans, not `font-display` (the DM Serif Display face) — a
              deliberate departure from this app's usual "serif only for
              editorial titles, never heavy" rule (web/CLAUDE.md), on an
              explicit "punchier, high-contrast like Zoopla/Zillow"
              instruction for this specific results-page title. font-black
              (900) isn't achievable: Plus Jakarta Sans is only loaded up to
              800 (app/layout.js's own `weight` list) and DM Serif Display
              has no bold cut at all — either would fake a weight the font
              doesn't have. font-extrabold (800) is the real heaviest
              available, same reasoning as PropertyCard's price.

              Mobile now steps back down to `text-lg font-bold` — Zoopla's
              own results-header title is genuinely smaller/lighter than
              the "punchier" treatment above asked for, per a direct
              follow-up instruction pointing at that exact reference
              screenshot. `lg:` (not `sm:`) is where it grows into the
              larger extrabold size, matching the breadcrumb/margin
              breakpoint just above so the whole block steps up together
              rather than piecemeal across different widths. */}
          <h1 className="text-lg font-bold leading-[1.15] tracking-tight text-ink lg:text-[1.875rem] lg:font-extrabold">
            {heading}
          </h1>
          {/* text-sm/font-normal throughout, including the count itself —
              Zoopla's own count line is a plain muted caption, not a
              semibold number standing out against the rest of the line. */}
          <p className="mt-1 text-sm font-normal text-ink-45">
            <span className="u-tabular">{total}</span> résultat{total !== 1 ? 's' : ''}
          </p>
          {locationRelaxed ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              Aucun résultat exact à {relaxedFromCommune} — recherche élargie à Kinshasa pour ces mots-clés.
            </p>
          ) : null}
          {citywide && (commune || quartier) ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              Rayon élargi à Kinshasa entière depuis {quartier || commune}.
            </p>
          ) : communeWide && quartier ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              Rayon élargi à {commune} entière depuis {quartier}.
            </p>
          ) : radiusExpanded ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              Aucun résultat à moins de {requestedRadius} km — élargi automatiquement à {effectiveRadius} km.
            </p>
          ) : null}
        </div>

        {/* Visible on every breakpoint now, not just sm: and up — this is
            "Trier"'s only home left. It used to duplicate the floating
            FloatingControlBar.js pill's own sort dropdown on mobile
            specifically because it was hidden here; that pill is gone
            entirely now (removed on an explicit instruction), so hiding
            this too would have left mobile with no way to sort at all. */}
        <span className="shrink-0">
          <SortDropdown />
        </span>
      </div>
    </div>
  );
}
