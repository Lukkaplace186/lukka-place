import Link from 'next/link';
import { getPopularCommunes } from '@/lib/listings';

/**
 * High-intent horizontal commune shortcuts, directly below the Hero.
 *
 * Real, DB-derived data (getPopularCommunes()) — the same principle
 * FilterBar's property-type pills already follow ("an option that would
 * return zero results is never offered", see web/CLAUDE.md). A hardcoded
 * five-commune list with fixed counts would go stale the moment a listing
 * is approved or removed, and "Ma Campagne" specifically isn't a commune —
 * it's a quartier inside Ngaliema (kinshasa_locations.json) — so it can
 * never legitimately appear in a commune-count list.
 *
 * Emoji per commune is decorative only, not a data claim, so a curated map
 * covering the real 24 communes is fine; anything outside it (or a future
 * commune not in this list) falls back to a plain marker glyph rather than
 * guessing.
 */
const COMMUNE_EMOJI = {
  Gombe: '🏢',
  Ngaliema: '🏡',
  Kintambo: '📍',
  Bandalungwa: '💼',
  Lemba: '🎓',
  Limete: '🏭',
  Kalamu: '🎭',
  'Kasa-Vubu': '🛍️',
  Ngaba: '🌳',
  Barumbu: '⚓',
  Kinshasa: '🏛️',
  Lingwala: '🏘️',
  Kimbanseke: '🏘️',
  Masina: '🏘️',
  Ndjili: '🏘️',
  Matete: '🏘️',
  Bumbu: '🏘️',
  Makala: '🏘️',
  Selembao: '🏘️',
  'Mont-Ngafula': '⛰️',
  'Ngiri-Ngiri': '🏘️',
  Kisenso: '🏘️',
  Maluku: '🌾',
  Nsele: '🌾',
};

export default async function CommuneShortcuts() {
  const communes = await getPopularCommunes(8);
  if (!communes.length) return null;

  return (
    <section className="border-b border-line bg-surface py-4">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        {/* -mx-4/px-4 lets the row bleed to the true viewport edge on mobile
            (so the first/last chip isn't flush against the container's own
            padding) while overflow-x-auto + no-scrollbar (globals.css) gives
            a native, scrollbar-free swipe with no body-level overflow — the
            scroll is contained to this row, not the page. */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {communes.map(({ commune, count }) => (
            <Link
              key={commune}
              href={`/listings?commune=${encodeURIComponent(commune)}`}
              className="u-press flex shrink-0 items-center gap-2 rounded-full border border-line bg-canvas px-4 py-2.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:bg-blue-tint hover:text-blue-deep"
            >
              <span aria-hidden="true">{COMMUNE_EMOJI[commune] || '📍'}</span>
              {commune}
              <span className="u-tabular text-ink-25">{count}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
