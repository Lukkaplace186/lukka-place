import { redirect } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import ChatInbox from '@/components/chat/ChatInbox';
import { getChatViewer, listThreads } from '@/lib/chat';
import { normaliseInboxFilter } from '@/lib/chatRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { AgentMessagesFrame, AgentMessagesListColumn } from './frame';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('chat.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * The agent's inbox (Messagerie — web/CLAUDE.md). A phone shows the list; a
 * computer shows the list beside an empty pane until a conversation opens
 * (/compte/agent/messages/[id] keeps the list on its left).
 */
export default async function AgentMessagesPage({ searchParams }) {
  const viewer = await getChatViewer('agent');
  if (!viewer) redirect('/compte/agent/connexion');
  const t = await getT();
  const filter = normaliseInboxFilter((await searchParams)?.filter);
  const { threads, nextCursor } = await listThreads(viewer, { filter });

  return (
    <AgentMessagesFrame>
      <AgentMessagesListColumn t={t} className="w-full lg:w-[22.5rem]">
        <ChatInbox
          side="agent"
          variant="column"
          basePath="/compte/agent/messages"
          initialThreads={threads}
          initialCursor={nextCursor}
          initialFilter={filter}
          serverNow={new Date().toISOString()}
        />
      </AgentMessagesListColumn>
      <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas-alt px-8 text-center lg:flex">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-surface text-ink-35 ring-1 ring-line">
          <MessagesSquare strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="u-title-card text-ink">{t('chat.agent.pickTitle')}</p>
        <p className="max-w-[24rem] text-[0.875rem] text-ink-45">{t('chat.agent.pickBody')}</p>
      </div>
    </AgentMessagesFrame>
  );
}
