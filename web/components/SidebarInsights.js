import Link from 'next/link';

const RELATED_SEARCHES = [
  { label: 'Appartements à Kinshasa', href: '/listings?property_type=appartement' },
  { label: 'Parcelles à vendre', href: '/listings?property_type=parcelle&transaction_type=vente' },
  { label: 'Biens à louer', href: '/listings?transaction_type=location' },
  { label: 'Maisons Type Locataire', href: '/listings?property_type=parcelle&parcelle_subtype=maison_type_locataire' },
];

/**
 * Right-column sidebar. `popularCommunes` (see lib/listings.js's
 * getPopularCommunes) is real data — communes ranked by their actual current
 * listing count, never a fabricated or hand-picked ranking. It's often empty
 * today (see PLAN.md/CLAUDE.md's known gap: most live listings predate the
 * commune-tagging feature), in which case this falls back to a plain
 * alphabetical slice of the full commune list — framed as navigation, not a
 * "popular" claim we have no data to back.
 */
export default function SidebarInsights({ popularCommunes, allCommunes }) {
  const hasRealRanking = popularCommunes.length > 0;
  const communeLinks = hasRealRanking ? popularCommunes : allCommunes.slice(0, 6).map((commune) => ({ commune }));

  return (
    <aside className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="u-eyebrow mb-4">{hasRealRanking ? 'Communes populaires' : 'Explorez par commune'}</h2>
        <ul className="flex flex-col gap-2">
          {communeLinks.map(({ commune, count }) => (
            <li key={commune}>
              <Link
                href={`/listings?commune=${encodeURIComponent(commune)}`}
                className="flex items-center justify-between text-[0.8125rem] text-ink-70 transition-colors hover:text-blue-deep"
              >
                <span>{commune}</span>
                {count != null && <span className="u-tabular text-xs text-ink-25">{count}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="u-eyebrow mb-4">Recherches associées</h2>
        <ul className="flex flex-col gap-2">
          {RELATED_SEARCHES.map(({ label, href }) => (
            <li key={href}>
              <Link href={href} className="text-[0.8125rem] text-ink-70 transition-colors hover:text-blue-deep">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
