'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getT } from '@/lib/i18n/server';
import { sendWhatsAppMessage, updateLeadStatus } from '@/lib/adminApi';
import { normalizeStoredPhone } from '@/lib/phone';
import { resolveOwnedTarget, getAlternativeSuggestions, loadChosenAlternatives } from '@/lib/agentAlternatives';
import { buildAlternativesMessage } from '@/lib/listingAlternatives';

const KINDS = new Set(['lead', 'visit']);

/**
 * "Proposer des alternatives", step 1: ranked suggestions for one of the
 * agent's own leads or visit requests. The customer's name and number come
 * back from the stored row so the dialog can preview the message and offer
 * the agent's own WhatsApp as a second way to send it.
 */
export async function getAlternativesAction(kind, id, { includePublic = false } = {}) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.alternatives.errors.auth') };
  if (!KINDS.has(kind)) return { ok: false, error: t('agent.alternatives.errors.notFound') };

  try {
    const target = await resolveOwnedTarget(agentId, kind, id);
    if (!target) return { ok: false, error: t('agent.alternatives.errors.notFound') };
    const suggestions = await getAlternativeSuggestions(agentId, target, { includePublic: Boolean(includePublic) });
    return {
      ok: true,
      name: target.name,
      waId: normalizeStoredPhone(target.waId),
      excludedId: target.propertyId,
      ...suggestions,
    };
  } catch (err) {
    console.error(`[compte/agent] alternatives for ${kind} #${id} failed: ${err.message}`);
    return { ok: false, error: t('agent.alternatives.errors.loadFailed') };
  }
}

/**
 * Step 2: ONE WhatsApp message through the engine (the Lukka Place number,
 * same path as replyToLeadAction). The text is rebuilt here from the listings
 * re-read under the public filter — never taken from the browser — and goes
 * to the number on the stored row.
 *
 * `sent` is the engine accepting the send, not delivery: a customer outside
 * WhatsApp's 24h window will not receive a session message, which is why the
 * dialog also offers the agent's own WhatsApp.
 */
export async function sendAlternativesAction(kind, id, propertyIds) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.alternatives.errors.auth') };
  if (!KINDS.has(kind)) return { ok: false, error: t('agent.alternatives.errors.notFound') };

  let target;
  let chosen;
  try {
    target = await resolveOwnedTarget(agentId, kind, id);
    if (!target) return { ok: false, error: t('agent.alternatives.errors.notFound') };
    chosen = await loadChosenAlternatives(target, Array.isArray(propertyIds) ? propertyIds : []);
  } catch (err) {
    console.error(`[compte/agent] alternatives send check for ${kind} #${id} failed: ${err.message}`);
    return { ok: false, error: t('agent.alternatives.errors.loadFailed') };
  }
  if (!chosen.ok) return { ok: false, error: t(`agent.alternatives.errors.${chosen.reason}`) };

  const phone = normalizeStoredPhone(target.waId);
  if (!phone) return { ok: false, error: t('agent.alternatives.errors.noPhone') };

  try {
    await sendWhatsAppMessage(phone, buildAlternativesMessage(chosen.listings, { name: target.name }));
  } catch (err) {
    console.error(`[compte/agent] alternatives WhatsApp for ${kind} #${id} failed: ${err.message}`);
    return { ok: false, error: t('errors.sendFailed') };
  }

  // Same as a reply: a request still at NEW has now been contacted.
  if (kind === 'lead' && target.lead?.status === 'NEW') {
    await updateLeadStatus(target.leadId, 'CONTACTED').catch((err) =>
      console.warn(`[compte/agent] lead #${target.leadId} status after alternatives: ${err.message}`),
    );
    revalidatePath('/compte/agent/demandes');
    revalidatePath('/compte/agent');
  }
  return { ok: true, count: chosen.listings.length };
}
