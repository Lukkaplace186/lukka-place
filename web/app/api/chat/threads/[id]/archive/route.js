import { setArchived } from '@/lib/chat';
import { badRequest, chatResult, readChatJson, requireChatViewer } from '@/lib/chatApi';

/** POST /api/chat/threads/:id/archive?as=agent  {archived: boolean} — the viewer's side only. */
export async function POST(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const body = await readChatJson(request);
  if (!body || typeof body.archived !== 'boolean') return badRequest();
  const { id } = await params;
  return chatResult(await setArchived(viewer, id, body.archived));
}
