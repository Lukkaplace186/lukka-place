import { reportThread } from '@/lib/chat';
import { badRequest, chatResult, readChatJson, requireChatViewer } from '@/lib/chatApi';

/**
 * POST /api/chat/threads/:id/report?as=agent  {reason, note?, messageId?}
 * reason: scam | harassment | spam | other. Goes to the Lukka Place team.
 */
export async function POST(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const body = await readChatJson(request);
  if (!body) return badRequest();
  const { id } = await params;
  return chatResult(await reportThread(viewer, id, { reason: body.reason, note: body.note, messageId: body.messageId }));
}
