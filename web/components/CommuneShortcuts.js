import Link from 'next/link';
import { getPopularCommunes } from '@/lib/listings';

/**
 * web/Design's commune row, directly under the hero search panel: a bold
 * "Communes" label followed by plain `.u-tag` pills.
 *
 * Real, DB-derived data (getPopularCommunes()) — the same principle
 * FilterBar's property-type pills already follow ("an option that would
 * return zero results is never offered", see web/CLAUDE.md). A hardcoded
 * list would go stale the moment a listing is approved or removed, and "Ma
 * Campagne" specifically isn't a commune — it's a quartier inside Ngaliema
 * (kinshasa_locations.json) — so it can never legitimately appear here.
 *
 * The per-commune emoji and the trailing listing count are both gone: the
 * design's row carries neither, just the commune name in a pill.
 */
export default async function CommuneShortcuts() {
  const communes = await getPopularCommunes(8);
  if (!communes.length) return null;

  return (
    <section className="bg-surface">
      <div className="mx-auto max-w-[1240px] px-4 pt-10 sm:px-6 lg:px-8">
        {/* -mx-4/px-4 lets the row bleed to the true viewport edge on mobile
            (so the first/last chip isn't flush against the container's own
            padding) while overflow-x-auto + no-scrollbar (globals.css) gives
            a native, scrollbar-free swipe with no body-level overflow — the
            scroll is contained to this row, not the page. */}
        <div className="no-scrollbar -mx-4 flex items-center gap-2.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <span className="mr-1.5 shrink-0 text-[0.875rem] font-bold text-ink">Communes</span>
          {communes.map(({ commune }) => (
            <Link
              key={commune}
              href={`/listings?commune=${encodeURIComponent(commune)}`}
              className="u-press u-tag shrink-0 transition-colors hover:bg-blue-tint hover:text-blue-deep"
            >
              {commune}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
