import Link from 'next/link';
import { BedSingle, Briefcase, Building, Building2, Fence, House, Store, Tractor, Warehouse } from 'lucide-react';
import { ApartmentIcon, LandIcon } from './icons/PropertyTypeIcons';
import { getT } from '@/lib/i18n/server';
import { COMMERCIAL_FILTER_VALUE, groupTypeFacets } from '@/lib/commercialSpaces';

/**
 * "Par type de bien" on the homepage (2026-10-06 storefront upgrade): one
 * tile per property type that has approved listings, with its real count,
 * straight into /listings filtered by it. The list and the counts are the
 * same getPropertyTypeFacets() the hero's type dropdown already reads, so a
 * tile never leads to an empty page. Names are the database's own category
 * names (not dictionary copy). Renders nothing with fewer than two types —
 * a single tile is not a choice.
 *
 * Offices, shops and warehouses share ONE tile, "Bureaux & commerces" (all
 * commercial categories, /listings?property_type=commercial), so commercial
 * space reads as its own section rather than taking three of six tiles from
 * homes. A lone commercial type keeps its own name.
 */
const ICONS = [
  [/ferme|agricole/, Tractor],
  [/appart|studio|duplex|penthouse/, ApartmentIcon],
  [/chambre|annexe/, BedSingle],
  [/terrain|parcelle/, LandIcon],
  [/^commercial$/, Building2],
  [/bureau/, Briefcase],
  [/boutique|commerce/, Store],
  [/entrep|d[eé]p[oô]t/, Warehouse],
  [/immeuble|b[aâ]timent/, Building],
  [/concession/, Fence],
];

function iconFor(value) {
  return ICONS.find(([pattern]) => pattern.test(value))?.[1] || House;
}

export default async function PropertyTypeTiles({ propertyTypes = [] }) {
  const t = await getT();
  const { residential, commercial } = groupTypeFacets(propertyTypes.filter((type) => type.count > 0));
  const singles = commercial.filter((type) => !type.umbrella);
  const commercialTile = singles.length > 1
    ? {
        value: COMMERCIAL_FILTER_VALUE,
        label: t('listings.commercial.group.commercial'),
        count: singles.reduce((sum, type) => sum + type.count, 0),
      }
    : singles[0] || null;
  const types = [...residential.slice(0, commercialTile ? 5 : 6), commercialTile].filter(Boolean);
  if (types.length < 2) return null;
  return (
    <section className="bg-canvas pb-8 pt-2 sm:pb-12">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <h2 className="u-title-section mb-4 text-ink sm:mb-5">{t('home.types.title')}</h2>
        <ul className="u-stagger grid grid-cols-3 gap-2.5 sm:gap-4 lg:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          {types.map(({ value, label, count }) => {
            const Icon = iconFor(value);
            return (
              <li key={value}>
                <Link
                  href={`/listings?property_type=${encodeURIComponent(value)}`}
                  className="u-press flex h-full flex-col items-start gap-2.5 rounded-card bg-surface p-2.5 sm:flex-row sm:items-center sm:gap-3 shadow-[var(--hairline),var(--shadow-card)] transition-shadow hover:shadow-[var(--hairline),var(--shadow-card-hover)] sm:p-5"
                >
                  {/* A plain line icon, no tinted tile (2026-10-07, same as /a-propos). */}
                  <Icon strokeWidth={1.5} className="h-6 w-6 shrink-0 text-blue sm:h-7 sm:w-7" aria-hidden="true" />
                  <span className="w-full min-w-0">
                    <span className="block truncate text-[0.75rem] font-bold text-ink min-[380px]:text-[0.8125rem] sm:text-[0.9375rem]">{label}</span>
                    <span className="u-tabular block text-[0.75rem] text-ink-45 sm:text-[0.8125rem]">{t('home.types.count', { count })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
