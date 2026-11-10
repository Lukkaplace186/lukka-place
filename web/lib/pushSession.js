import 'server-only';
import { getCurrentChatAgentId } from './chat';
import { getCurrentCustomerId } from './customers';

/**
 * Who a push request speaks for: the named side's OWN session, checked the
 * way every page checks it (agent: token_version + not deleted, lib/chat.js;
 * customer: token_version, lib/customers.js). One browser can hold both
 * sessions (an agent who also rents); the side is named by the page, the
 * identity always comes from that side's cookie.
 *
 * @param {'agent'|'customer'} side
 * @returns {Promise<{userType: 'agent'|'customer', userId: number}|null>}
 */
export async function currentPushAccount(side) {
  if (side === 'customer') {
    const id = await getCurrentCustomerId();
    return id ? { userType: 'customer', userId: Number(id) } : null;
  }
  const id = await getCurrentChatAgentId();
  return id ? { userType: 'agent', userId: Number(id) } : null;
}
