import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { loadAgentTodo } from '@/lib/agentTodoLoader';
import { TODO_ALL_LIMIT } from '@/lib/agentTodo';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentTodayPanel from '@/components/AgentTodayPanel';

/**
 * Every "À faire aujourd'hui" item, uncapped — where the overview's single
 * "Voir les N actions" link goes. Same loader, same ranking and the same
 * one-tap actions as the overview's three rows; nothing here is a second
 * definition of what needs doing.
 */
export default async function AgentActionsPage() {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  const context = await getAgentDashboardContext(agentId);
  if (!context) redirect('/compte/agent/connexion');
  const { listingById, leadScope, hasLeadScope, newLeadsCount } = context;

  const todo = await loadAgentTodo({ agentId, leadScope, hasLeadScope }, { limit: TODO_ALL_LIMIT });

  return (
    <>
      <AgentPageHeader title={t('agent.today.allTitle')} newLeadsCount={newLeadsCount} />
      <div className="flex flex-col gap-3 px-3 py-4 sm:px-8 sm:py-7">
        <Link
          href="/compte/agent"
          className="u-press inline-flex min-h-10 items-center gap-1 self-start rounded-lg px-1 text-[0.8125rem] font-bold text-blue-deep"
        >
          <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.overview.title')}
        </Link>
        <AgentTodayPanel todo={todo} listingById={listingById} showAll />
      </div>
    </>
  );
}
