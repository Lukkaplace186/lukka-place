import { isAppRequest } from '@/lib/appMode';
import { notFound, redirect } from 'next/navigation';
import ChatThread from '@/components/chat/ChatThread';
import { getChatViewer, getThread, listMessages } from '@/lib/chat';
import { parseId } from '@/lib/chatRules';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('chat.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * One conversation, customer side (Messagerie — web/CLAUDE.md). Not the
 * viewer's, or missing: the same 404. Signed out: the login page, back here.
 */
export default async function ConversationPage({ params }) {
  const { id } = await params;
  const threadId = parseId(id);
  if (!threadId) notFound();

  const viewer = await getChatViewer('customer');
  if (!viewer) redirect(`/compte/connexion?next=${encodeURIComponent(`/messages/${threadId}`)}`);

  const thread = await getThread(viewer, threadId);
  if (!thread) notFound();
  const page = await listMessages(viewer, threadId);

  return (
    <ChatThread
      side="customer"
      thread={thread}
      initialMessages={page?.messages ?? []}
      initialHasMore={page?.hasMore ?? false}
      serverNow={new Date().toISOString()}
      backHref="/messages"
      appMode={await isAppRequest()}
    />
  );
}
