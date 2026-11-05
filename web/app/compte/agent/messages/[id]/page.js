import { notFound, redirect } from 'next/navigation';
import ChatInbox from '@/components/chat/ChatInbox';
import ChatThread from '@/components/chat/ChatThread';
import ChatClientPanel from '@/components/chat/ChatClientPanel';
import { getChatViewer, getThread, listMessages, listShareableListings, listThreads } from '@/lib/chat';
import { normaliseInboxFilter, parseId } from '@/lib/chatRules';
import { listQuickReplies, getQuickReplyListings } from '@/lib/quickReplies';
import { quickReplyFacts, renderQuickReply } from '@/lib/quickReplyRules';
import { getT } from '@/lib/i18n/server';
import { AgentMessagesFrame, AgentMessagesListColumn } from '../frame';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('chat.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * The agent's three columns (Messagerie — web/CLAUDE.md): conversations,
 * the open one, and the customer panel. A phone shows the conversation only,
 * with its back arrow to the list; the customer panel appears from xl up.
 *
 * Quick replies are the agent's own templates (lib/quickReplies.js), filled
 * with this conversation's listing and the customer's first name by the same
 * renderQuickReply the Demandes inbox uses, so a line whose fact is missing is
 * dropped rather than sent with a hole in it.
 */
export default async function AgentConversationPage({ params, searchParams }) {
  const { id } = await params;
  const threadId = parseId(id);
  if (!threadId) notFound();
  const viewer = await getChatViewer('agent');
  if (!viewer) redirect('/compte/agent/connexion');

  const thread = await getThread(viewer, threadId);
  if (!thread) notFound();

  const t = await getT();
  const filter = normaliseInboxFilter((await searchParams)?.filter);
  const [page, inbox, shareable, quick, ownListings] = await Promise.all([
    listMessages(viewer, threadId),
    listThreads(viewer, { filter }),
    listShareableListings(viewer.id).catch(() => []),
    listQuickReplies(viewer.id).catch(() => ({ templates: [] })),
    thread.propertyId ? getQuickReplyListings(viewer.id).catch(() => []) : Promise.resolve([]),
  ]);

  const listingRow = ownListings.find((row) => Number(row.id) === thread.propertyId) || null;
  const firstName = (thread.counterpart.name || '').split(' ')[0] || null;
  const facts = quickReplyFacts(listingRow, { name: firstName });
  const quickReplies = (quick.templates || [])
    .map((template) => ({ label: template.title, text: renderQuickReply(template.body, facts).text }))
    .filter((reply) => reply.label && reply.text);

  return (
    <AgentMessagesFrame>
      <AgentMessagesListColumn t={t} className="hidden w-[22.5rem] lg:flex">
        <ChatInbox
          side="agent"
          variant="column"
          basePath="/compte/agent/messages"
          initialThreads={inbox.threads}
          initialCursor={inbox.nextCursor}
          initialFilter={filter}
          serverNow={new Date().toISOString()}
          activeId={thread.id}
        />
      </AgentMessagesListColumn>
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatThread
          key={thread.id}
          side="agent"
          variant="agent"
          thread={thread}
          initialMessages={page?.messages ?? []}
          initialHasMore={page?.hasMore ?? false}
          serverNow={new Date().toISOString()}
          backHref="/compte/agent/messages"
          quickReplies={quickReplies}
          shareableListings={shareable}
        />
      </div>
      <aside aria-label={t('chat.agent.panelLabel')} className="hidden w-[18.75rem] flex-none border-l border-line bg-surface xl:block">
        <ChatClientPanel thread={thread} />
      </aside>
    </AgentMessagesFrame>
  );
}
