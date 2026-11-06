import { getThread, listMessages, sendMessage } from '@/lib/chat';
import { badRequest, chatJson, chatResult, readChatJson, requireChatViewer } from '@/lib/chatApi';

/**
 * GET  /api/chat/threads/:id/messages?as=agent&after=ID — the poll: messages
 *      newer than ID, plus the other side's read position (the "Lu" ticks)
 *      and whether the thread is blocked. `before=ID` pages back instead.
 *      Reading here never marks anything read; that is POST …/read.
 * POST /api/chat/threads/:id/messages  {body, clientId, kind?, propertyId?}
 *      Sends one message. `kind: 'listing'` is for agents sharing one of
 *      their own public listings. A repeated clientId returns the stored
 *      message (200, duplicate: true).
 */

export async function GET(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const page = await listMessages(viewer, id, { after: search.get('after'), before: search.get('before') });
  if (!page) return chatJson({ error: 'not-found' }, 404);
  const thread = await getThread(viewer, id);
  if (!thread) return chatJson({ error: 'not-found' }, 404);
  return chatJson({
    messages: page.messages,
    hasMore: page.hasMore,
    otherLastReadId: thread.otherLastReadId,
    blocked: thread.blocked,
    blockedBy: thread.blockedBy,
  });
}

export async function POST(request, { params }) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const body = await readChatJson(request);
  if (!body) return badRequest();
  const { id } = await params;
  const result = await sendMessage(viewer, id, {
    body: body.body,
    clientId: body.clientId,
    kind: body.kind ?? 'text',
    propertyId: body.propertyId,
  });
  return chatResult(result, result.status === 'ok' && { message: result.message, duplicate: result.duplicate });
}
