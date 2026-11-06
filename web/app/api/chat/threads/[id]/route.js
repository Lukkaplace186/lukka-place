import { getThread, listMessages } from '@/lib/chat';
import { chatJson, requireChatViewer } from '@/lib/chatApi';

/**
 * GET /api/chat/threads/:id?as=agent — the thread (other side, listing card,
 * read state, blocked) and its latest page of messages. A thread that is not
 * the viewer's is the same 404 as one that does not exist.
 */
export async function GET(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const { id } = await params;
  const thread = await getThread(viewer, id);
  if (!thread) return chatJson({ error: 'not-found' }, 404);
  const page = await listMessages(viewer, thread.id);
  return chatJson({ thread, messages: page?.messages ?? [], hasMore: page?.hasMore ?? false });
}
