import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import AgentClientMatchesChip from './AgentClientMatches';

const SHOWN = 3;

/**
 * Overview card: the agent's listings that clients in their private book are
 * looking for right now, most-wanted first. Renders nothing when there is no
 * match — an empty "your clients" card on the overview would be noise.
 *
 * @param {{book: Object, entriesByListing: Record<string, Object[]>}} props
 */
export default async function AgentClientMatchesCard({ book, entriesByListing }) {
  const t = await getT();
  const rows = (book?.listings || [])
    .map((listing) => ({ listing, entries: entriesByListing[String(listing.id)] || [] }))
    .filter((row) => row.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length);
  if (rows.length === 0) return null;

  return (
    <section className="u-card rounded-card bg-surface p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="u-title-card text-ink">{t('agent.clients.overviewTitle')}</h2>
        <Link href="/compte/agent/clients" className="u-micro-strong shrink-0 text-blue-deep hover:underline">
          {t('agent.clients.overviewLink')}
        </Link>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {rows.slice(0, SHOWN).map(({ listing, entries }) => (
          <li key={listing.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="line-clamp-2 min-w-0 text-sm font-semibold text-ink">{listing.title}</span>
            <AgentClientMatchesChip entries={entries} align="end" />
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && (
        <p className="u-micro mt-1 text-ink-45">{t('agent.clients.overviewMore', { count: rows.length - SHOWN })}</p>
      )}
    </section>
  );
}
