import { setBlocked } from '@/lib/chat';
import { badRequest, chatResult, readChatJson, requireChatViewer } from '@/lib/chatApi';

/**
 * POST /api/chat/threads/:id/block?as=agent  {blocked: boolean}
 * Blocking stops new messages both ways; only the side that blocked can lift it.
 */
export async function POST(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const body = await readChatJson(request);
  if (!body || typeof body.blocked !== 'boolean') return badRequest();
  const { id } = await params;
  return chatResult(await setBlocked(viewer, id, body.blocked));
}
