import { countUnread } from '@/lib/chat';
import { chatJson, requireChatViewer } from '@/lib/chatApi';

/**
 * GET /api/chat/unread?as=agent — `{messages: n, threads: n}`: unread messages
 * (what the menu badges and the tab title show) and the conversations they
 * are in. lib/useChatUnread.js polls it.
 */
export async function GET(request) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  return chatJson(await countUnread(viewer));
}
