import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import { getPublicAgents } from '@/lib/agents';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

export const metadata = {
  title: 'Agents — Lukka Place',
  description: 'Agents immobiliers actifs à Kinshasa, avec des annonces réelles publiées sur Lukka Place.',
};

/**
 * Public agent directory — the "Agents" tab in the hero search bar
 * (web/Design's own homeTabs: Louer/Acheter/Parcelles/Agents) had nowhere
 * to land before this; only /agents/[id] (a single agent's storefront)
 * existed. getPublicAgents() (lib/agents.js) already excludes inactive
 * accounts and anyone with zero real listings, so every card here links to
 * a profile that actually has something behind it — no empty directory
 * entries, same honesty convention ExploreCommunes.js follows for commune
 * tiles.
 */
export default async function AgentsDirectoryPage() {
  const agents = await getPublicAgents();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-ink sm:text-3xl">
          Agents à Kinshasa
        </h1>
        <p className="mt-1.5 text-sm text-ink-45">
          {agents.length} agent{agents.length === 1 ? '' : 's'} actif{agents.length === 1 ? '' : 's'}, avec des
          annonces vérifiées.
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          Aucun agent actif pour le moment.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const name = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || '—';
            const communes = agent.primary_communes || [];
            return (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="u-press flex items-center gap-3 rounded-card border border-line bg-white p-4 transition-colors hover:border-blue/40"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-line bg-canvas-alt">
                  <AgentAvatar src={agent.image} alt={name} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-ink">{name}</span>
                    {agent.phone_verified_at ? (
                      <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-green-deep" />
                    ) : null}
                  </div>
                  {agent.vendor_username ? (
                    <p className="truncate text-sm text-ink-45">{agent.vendor_username}</p>
                  ) : null}
                  <p className="u-tabular mt-0.5 text-xs text-ink-45">
                    {agent.live_listing_count} annonce{agent.live_listing_count !== 1 ? 's' : ''}
                    {communes.length > 0 ? ` · ${communes.slice(0, 2).join(', ')}` : ''}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
