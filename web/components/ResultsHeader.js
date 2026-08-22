import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import SortDropdown from './SortDropdown';
import SaveSearchButton from './SaveSearchButton';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Results header — breadcrumb, real result count, save-search and sort,
 * following the reference (Rightmove puts exactly this row above its
 * results and it is the clearest orientation device on the page).
 *
 * The heading is built from the filters actually applied, never a static or
 * invented location. SaveSearchButton moved here out of the filter bar: it
 * is an action on the result set, not a filter, and inside the filter form
 * it sat among controls that change the query it would be saving.
 */
function buildHeading({ commune, quartier, transactionType, propertyTypeLabel }) {
  const subject = propertyTypeLabel || 'Biens';
  const place = quartier || commune || 'Kinshasa';
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
}) {
  const heading = buildHeading({ commune, quartier, transactionType, propertyTypeLabel });

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
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SaveSearchButton />
          <span className="hidden sm:block">
            <SortDropdown />
          </span>
        </div>
      </div>
    </div>
  );
}
