import 'server-only';
import { sendAgentOtp } from './agents';
import { canSendCode, noteCodeSent } from './signInCodeLimits';

/**
 * An agent's confirmation code on WhatsApp (2026-11-24, owner: agents type a
 * code we send instead of sending us one — 24 of 78 never did). The same
 * limits as the customers' sign-in code (lib/signInCodeLimits.js, keyed
 * `agent:<id>` so the two never share a count): 3 codes per account per
 * 10 minutes. Never throws.
 *
 * @param {{id: number|string, phone: string}} agent
 * @returns {Promise<'sent'|'busy'|'failed'>}
 */
export async function sendAgentCode(agent) {
  const key = agentCodeKey(agent.id);
  if (!canSendCode(key)) return 'busy';
  try {
    await sendAgentOtp(agent.id, agent.phone);
    noteCodeSent(key);
    return 'sent';
  } catch (err) {
    console.error(`[agent-auth] OTP send failed for agent #${agent.id}: ${err.message}`);
    return 'failed';
  }
}

/** The limits' key for an agent (a customer's is its bare id). */
export function agentCodeKey(agentId) {
  return `agent:${Number(agentId)}`;
}
