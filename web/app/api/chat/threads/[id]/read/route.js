import { markRead } from '@/lib/chat';
import { badRequest, chatResult, readChatJson, requireChatViewer } from '@/lib/chatApi';

/** POST /api/chat/threads/:id/read?as=agent  {upTo} — marks the viewer's side read up to that message. */
export async function POST(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const body = await readChatJson(request);
  if (!body) return badRequest();
  const { id } = await params;
  return chatResult(await markRead(viewer, id, body.upTo));
}
