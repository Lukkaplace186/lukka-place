import { countUnreadThreads } from '@/lib/chat';
import { chatJson, requireChatViewer } from '@/lib/chatApi';

/** GET /api/chat/unread?as=agent — `{threads: n}`, conversations with an unread message (the menu badge). */
export async function GET(request) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  return chatJson({ threads: await countUnreadThreads(viewer) });
}
