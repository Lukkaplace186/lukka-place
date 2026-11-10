import { getCurrentCustomerId } from '@/lib/customers';
import { chatJson, readChatJson } from '@/lib/chatApi';
import { followAgent, unfollowAgent } from '@/lib/customerFollows';
import { parseId } from '@/lib/pushRules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/account/follows — `{agentId, follow: true|false}`: the signed-in
 * customer follows (or stops following) an agency; the Lukka Place app then
 * pushes its new listings (lib/portalDigests.js runFollowedAgentListings).
 * The customer is the session's, never a request value. JSON only (a
 * cross-site form cannot send it; the session cookie is SameSite=Lax).
 */
export async function POST(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return chatJson({ error: 'unauthorized' }, 401);
  const body = await readChatJson(request);
  const agentId = parseId(body?.agentId);
  if (!agentId || typeof body?.follow !== 'boolean') return chatJson({ error: 'invalid' }, 400);
  const result = body.follow ? await followAgent(customerId, agentId) : await unfollowAgent(customerId, agentId);
  if (result === 'ok') return chatJson({ ok: true, following: body.follow });
  const status = { 'not-found': 404, limit: 409, unavailable: 503 }[result] || 500;
  return chatJson({ error: result }, status);
}
