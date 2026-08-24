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
    <div className="mb-5">
      <nav aria-label="Fil d'Ariane" className="mb-4 flex flex-wrap items-center gap-1 text-[0.75rem] text-ink-45">
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
          <h1 className="font-display text-[1.5rem] font-normal leading-[1.15] tracking-[-0.02em] text-ink sm:text-[1.875rem]">
            {heading}
          </h1>
          <p className="mt-1.5 text-[0.8125rem] text-ink-45">
            <span className="u-tabular font-semibold text-ink">{total}</span> résultat{total !== 1 ? 's' : ''}
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

        <span className="hidden shrink-0 sm:block">
          <SortDropdown />
        </span>
      </div>
    </div>
  );
}
