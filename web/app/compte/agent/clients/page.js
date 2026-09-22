import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getAgentClientBookSafe } from '@/lib/agentClients';
import { matchEntriesForClient, BUDGET_TOLERANCE } from '@/lib/clientMatching';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentClientDialog from '@/components/AgentClientDialog';
import AgentClientCard from '@/components/AgentClientCard';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.clients.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * The agent's private client book: people they are working with in their OWN
 * WhatsApp chats, which Lukka Place never sees. Each client shows how many of
 * the agent's live listings fit them right now (lib/clientMatching.js, at read
 * time), and each listing on Mes biens / the overview / the edit page shows
 * the reverse. Visible to this agent only — see lib/agentClients.js.
 */
export default async function AgentClientsPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';

  const agentId = await getCurrentAgentId();
  const context = await getAgentDashboardContext(agentId);
  if (!context) redirect('/compte/agent/connexion');

  const [book, hierarchy] = await Promise.all([
    getAgentClientBookSafe(agentId),
    getLocationHierarchyWithFallback().catch(() => ({ communes: [] })),
  ]);
  const communes = hierarchy?.communes ?? [];

  const needle = q.toLowerCase();
  const clients = needle
    ? book.clients.filter((c) =>
        `${c.name} ${c.phone} ${c.communes.join(' ')} ${c.notes || ''}`.toLowerCase().includes(needle),
      )
    : book.clients;
  const matching = book.clients.filter((c) => (book.byClient[c.id] || []).length > 0).length;

  return (
    <>
      <AgentPageHeader
        title={t('agent.clients.title')}
        newLeadsCount={context.newLeadsCount}
        searchAction="/compte/agent/clients"
        searchDefaultValue={q}
        searchPlaceholder={t('agent.clients.searchPlaceholder')}
        action={book.available && !book.hidden ? <AgentClientDialog communes={communes} /> : null}
      />

      <div className="flex flex-col gap-4 px-3 py-4 sm:px-8 sm:py-7">
        {book.hidden ? (
          <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
            {t('agent.clients.hiddenWhileImpersonating')}
          </div>
        ) : !book.available ? (
          <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
            {t('agent.clients.unavailable')}
          </div>
        ) : (
          <>
            <div>
              <div className="u-title-card text-ink">{t('agent.clients.count', { count: book.clients.length })}</div>
              <div className="u-micro mt-0.5 text-ink-45">
                {t('agent.clients.summary', { count: matching, pct: Math.round(BUDGET_TOLERANCE * 100) })}
              </div>
            </div>

            {clients.length === 0 ? (
              <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
                {q ? t('agent.clients.noResults') : t('agent.clients.empty')}
              </div>
            ) : (
              clients.map((client) => (
                <AgentClientCard
                  key={client.id}
                  client={client}
                  matches={matchEntriesForClient(book, client)}
                  communes={communes}
                />
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}
