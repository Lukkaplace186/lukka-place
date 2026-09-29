'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { createReportLink, revokeReportLink } from '@/lib/reportLinks';

/**
 * The owner's live report link, from the agent's listing page. Ownership is
 * in the SQL of every call (lib/reportLinks.js), so a crafted id creates or
 * revokes nothing. Impersonation is refused at the edge like every write.
 */

function revalidate(propertyId) {
  revalidatePath(`/compte/agent/biens/${propertyId}`);
}

/** Create the link, or return the existing one. `fresh` replaces it ("nouveau lien"). */
export async function createReportLinkAction(propertyId, { fresh = false } = {}) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, reason: 'auth' };
  try {
    const result = await createReportLink(agentId, propertyId, { fresh: Boolean(fresh) });
    if (result.ok) revalidate(propertyId);
    return result;
  } catch (err) {
    console.error(`[report-link] create for #${propertyId}: ${err.message}`);
    return { ok: false, reason: 'failed' };
  }
}

export async function revokeReportLinkAction(propertyId) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, reason: 'auth' };
  try {
    const revoked = await revokeReportLink(agentId, propertyId);
    if (revoked) revalidate(propertyId);
    return { ok: revoked, reason: revoked ? undefined : 'not_found' };
  } catch (err) {
    console.error(`[report-link] revoke for #${propertyId}: ${err.message}`);
    return { ok: false, reason: 'failed' };
  }
}
