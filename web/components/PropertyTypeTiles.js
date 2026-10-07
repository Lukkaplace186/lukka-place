import Link from 'next/link';
import { Building2, Fence, House, Store, Warehouse } from 'lucide-react';
import { getT } from '@/lib/i18n/server';

/**
 * "Par type de bien" on the homepage (2026-10-06 storefront upgrade): one
 * tile per property type that has approved listings, with its real count,
 * straight into /listings filtered by it. The list and the counts are the
 * same getPropertyTypeFacets() the hero's type dropdown already reads, so a
 * tile never leads to an empty page. Names are the database's own category
 * names (not dictionary copy). Renders nothing with fewer than two types —
 * a single tile is not a choice.
 */
const ICONS = [
  [/appart|studio|duplex|penthouse/, Building2],
  [/terrain|parcelle/, Fence],
  [/boutique|commerce|bureau/, Store],
  [/entrep|d[eé]p[oô]t|b[aâ]timent/, Warehouse],
];

function iconFor(value) {
  return ICONS.find(([pattern]) => pattern.test(value))?.[1] || House;
}

export default async function PropertyTypeTiles({ propertyTypes = [] }) {
  const types = propertyTypes.filter((type) => type.count > 0).slice(0, 6);
  if (types.length < 2) return null;
  const t = await getT();
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
