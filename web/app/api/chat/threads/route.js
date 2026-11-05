import { listThreads, startThread } from '@/lib/chat';
import { badRequest, chatJson, chatResult, readChatJson, requireChatViewer } from '@/lib/chatApi';

/**
 * GET  /api/chat/threads?as=agent&filter=all|unread|archived&cursor=…
 *      One inbox page of the signed-in side, newest first.
 * POST /api/chat/threads  {propertyId?, agentId?, body, clientId}
 *      A customer starts (or re-opens) a conversation with its first
 *      message. With a listing, the agent is the listing's own. Agents do not
 *      open conversations (403).
 *
 * Rules and access: lib/chat.js.
 */

export async function GET(request) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const page = await listThreads(viewer, { filter: params.get('filter'), cursor: params.get('cursor') });
  return chatJson(page);
}

export async function POST(request) {
  const { viewer, response } = await requireChatViewer(request);
  if (response) return response;
  if (viewer.role !== 'customer') return chatJson({ error: 'forbidden' }, 403);

  const body = await readChatJson(request);
  if (!body) return badRequest();
  const result = await startThread(viewer.id, {
    propertyId: body.propertyId,
    agentId: body.agentId,
    body: body.body,
    clientId: body.clientId,
  });
  return chatResult(result, result.status === 'ok' && {
    threadId: result.threadId,
    created: result.created,
    message: result.message,
  });
}
