import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/** Current query minus exactly one key — every other active filter is
 *  preserved. The sample this was built from built its "remove beds
 *  filter" link from `commune` alone, silently dropping property_type/
 *  price/quartier/sort/view too; this reads the real current params
 *  instead of reconstructing a guessed subset. */
function hrefWithout(params, key) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (k === key || v == null || v === '') continue;
    qs.set(k, Array.isArray(v) ? v[0] : v);
  }
  const s = qs.toString();
  return s ? `/listings?${s}` : '/listings';
}

const BEDS_LABEL = { beds_min: (v) => `${v}+ chambres`, property_type: (v) => v, bath_min: (v) => `${v}+ sdb` };

/**
 * Empty results.
 *
 * Offers real escape routes rather than a dead end: communes that genuinely
 * have approved listings right now (getPopularCommunes in lib/listings.js),
 * so every suggestion here is guaranteed to return results. Falls back to a
 * plain link to all listings when even that is empty.
 *
 * `params` (the page's raw searchParams) drives the targeted relaxation
 * links below — real report that prompted this: "3 bed house in Ngaliema"
 * has three independent reasons it could return 0 (wrong commune, no
 * 3-bed match, no maison in that commune), so offering one relaxation per
 * active filter lets a visitor try each independently rather than only
 * the blunt "clear everything" reset.
 */
export default function ListingsEmptyState({ popularCommunes = [], params = {}, propertyTypeLabel }) {
  const commune = params.commune;
  const relaxable = [
    params.beds_min ? { key: 'beds_min', label: `Retirer le filtre ${BEDS_LABEL.beds_min(params.beds_min)}` } : null,
    params.bath_min ? { key: 'bath_min', label: `Retirer le filtre ${BEDS_LABEL.bath_min(params.bath_min)}` } : null,
    params.property_type
      ? { key: 'property_type', label: `Retirer le filtre ${propertyTypeLabel || params.property_type}` }
      : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-alt text-ink-45">
        <SearchX strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </span>

      <h2 className="font-display text-xl font-normal tracking-[-0.01em] text-ink">Aucun bien ne correspond</h2>
      <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">
        {commune ? (
          <>
            Aucun bien ne correspond exactement à votre recherche à <span className="font-semibold">{commune}</span>.
          </>
        ) : (
          "Essayez d'élargir votre recherche — moins de filtres, une fourchette de prix plus large, ou une autre commune."
        )}
      </p>

      {commune || relaxable.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {commune ? (
            <Link
              href={`/listings?commune=${encodeURIComponent(commune)}`}
              className="u-press inline-flex items-center rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              Voir tous les biens à {commune}
            </Link>
          ) : null}
          {relaxable.map(({ key, label }) => (
            <Link
              key={key}
              href={hrefWithout(params, key)}
              className="u-press inline-flex items-center rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}

      {popularCommunes.length > 0 ? (
        <>
          <p className="u-eyebrow mt-8 mb-3">Communes avec des biens disponibles</p>
          <div className="flex flex-wrap justify-center gap-2">
            {popularCommunes.map(({ commune, count }) => (
              <Link
                key={commune}
                href={`/listings?commune=${encodeURIComponent(commune)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
              >
                {commune}
                <span className="u-tabular text-ink-25">{count}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <Link
        href="/listings"
        className="mt-8 inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
      >
        Voir toutes les annonces
      </Link>
    </div>
  );
}
