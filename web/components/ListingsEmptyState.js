import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Empty results.
 *
 * Offers real escape routes rather than a dead end: communes that genuinely
 * have approved listings right now (getPopularCommunes in lib/listings.js),
 * so every suggestion here is guaranteed to return results. Falls back to a
 * plain link to all listings when even that is empty.
 */
export default function ListingsEmptyState({ popularCommunes = [] }) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-alt text-ink-45">
        <SearchX strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </span>

      <h2 className="font-display text-xl font-normal tracking-[-0.01em] text-ink">Aucun bien ne correspond</h2>
      <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">
        Essayez d&apos;élargir votre recherche — moins de filtres, une fourchette de prix plus large, ou une autre
        commune.
      </p>

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
