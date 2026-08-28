'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import {
  AGENT_SESSION_COOKIE,
  verifyAgentSessionToken,
  hashPassword,
  verifyPasswordAgainstHash,
} from '@/lib/agentAuth';
import { bumpAgentTokenVersion, getAgentAuthById, resetAgentPassword } from '@/lib/agents';
import { clearAgentSession, getCurrentAgentId, establishAgentSession } from '@/lib/agentSession';
import {
  getAgentProfile,
  getOwnListingsForDashboard,
  agentDisplayName,
  updateAgentIdentity,
} from '@/lib/agencies';
import { listLeads, updateLeadStatus, sendWhatsAppMessage } from '@/lib/adminApi';
import { LEAD_STATUSES } from '@/lib/adminLabels';

const LISTING_STATUSES = ['active', 'under_offer', 'closed'];

/**
 * Defense-in-depth session check, matching every other write action in this
 * app (assertAdminSession in web/app/admin/listings/actions.js, etc.) —
 * middleware.js already gates /compte/agent/*, this re-verifies the token
 * itself rather than relying solely on that layer.
 * @returns {Promise<number>} the authenticated agent's id — throws if none.
 */
async function assertAgentSession() {
  const token = (await cookies()).get(AGENT_SESSION_COOKIE)?.value;
  const verified = verifyAgentSessionToken(token);
  if (!verified) throw new Error('Not authenticated');
  return verified.agentId;
}

export async function agentLogoutAction() {
  const agentId = await getCurrentAgentId();
  if (agentId) await bumpAgentTokenVersion(agentId);
  await clearAgentSession();
  redirect('/compte/agent/connexion');
}

/**
 * Real sales-lifecycle status, separate from properties.approve_status
 * (moderation) — conflating them would make "approved but under offer"
 * inexpressible. Scoped server-side to listings this agent actually owns
 * (p.agent_id = $2), not just hidden client-side.
 */
export async function updateListingStatusAction(propertyId, formData) {
  const agentId = await assertAgentSession();
  const status = String(formData.get('listing_status') || '');
  if (!LISTING_STATUSES.includes(status)) throw new Error(`listing_status must be one of: ${LISTING_STATUSES.join(', ')}`);

  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties SET listing_status = $1, updated_at = NOW() WHERE id = $2 AND agent_id = $3`,
    [status, propertyId, agentId],
  );
  if (rowCount === 0) throw new Error('Not your listing, or it does not exist.');

  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent');
  revalidatePath(`/listings/${propertyId}`);
}

/**
 * Mirrors app/admin/actions.js's updateLeadStatusAction but scoped to leads
 * tied to one of this agent's own properties — the admin version is a
 * blanket write with no ownership check, which is fine for a shared
 * internal tool but wrong here: an agent must never be able to change the
 * status of a lead they were never routed. Re-fetches this agent's own
 * lead ids server-side rather than trusting a client-supplied lead id
 * alone, same reasoning updateListingStatusAction's own doc comment gives.
 */
async function assertOwnedLead(agentId, leadId) {
  const [agent, listings] = await Promise.all([getAgentProfile(agentId), getOwnListingsForDashboard(agentId)]);
  const propertyIds = listings.map((l) => l.id);
  const displayName = agentDisplayName(agent);
  const { data } =
    propertyIds.length || displayName
      ? await listLeads({ propertyIds, assignedAgent: displayName || undefined, limit: 200 })
      : { data: [] };

  const lead = data.find((l) => l.id === leadId);
  if (!lead) throw new Error('Not your lead, or it does not exist.');
  return lead;
}

export async function updateAgentLeadStatusAction(leadId, formData) {
  const agentId = await assertAgentSession();
  const status = String(formData.get('status') || '');
  if (!LEAD_STATUSES.includes(status)) throw new Error(`status must be one of: ${LEAD_STATUSES.join(', ')}`);

  await assertOwnedLead(agentId, leadId);
  await updateLeadStatus(leadId, status);
  revalidatePath('/compte/agent/demandes');
  revalidatePath('/compte/agent');
}

/**
 * The design's inquiry card opens a real reply composer, so this sends a
 * real WhatsApp message rather than handing off to a wa.me link.
 *
 * Delivery goes through the engine's own Chakra connection
 * (POST /admin/send-whatsapp, via lib/adminApi.js) — `web/` holds no
 * WhatsApp credentials of its own, and this is the same path the agent
 * phone-verification OTP already uses. The recipient is read from the
 * *stored lead row* returned by the ownership check, never from the
 * submitted form: an agent can reply to their own lead, and cannot use
 * this to send a message to an arbitrary number.
 *
 * A lead still sitting at NEW is advanced to CONTACTED on a successful
 * send, so the inbox reflects what actually happened without the agent
 * having to set the status by hand as a second step. A send failure
 * deliberately does NOT advance it.
 */
export async function replyToLeadAction(leadId, formData) {
  const agentId = await assertAgentSession();
  const text = String(formData.get('text') || '').trim();
  if (!text) redirect('/compte/agent/demandes?reply_error=empty');

  const lead = await assertOwnedLead(agentId, leadId);

  try {
    await sendWhatsAppMessage(lead.wa_id, text);
  } catch (err) {
    console.error(`[compte/agent] WhatsApp reply to lead #${leadId} failed: ${err.message}`);
    redirect('/compte/agent/demandes?reply_error=send');
  }

  if (lead.status === 'NEW') {
    await updateLeadStatus(leadId, 'CONTACTED');
  }

  revalidatePath('/compte/agent/demandes');
  revalidatePath('/compte/agent');
  redirect('/compte/agent/demandes?reply_sent=1');
}

/**
 * The design's "Identité de l'agence" card, saving for real.
 *
 * Writes only the two fields this app actually reads back and renders on the
 * public storefront — the display name (agent_infos) and the presentation
 * text (vendor_infos.details) — through lib/agencies.js's
 * updateAgentIdentity, which handles the UPDATE-then-INSERT those
 * constraint-less per-language tables require.
 *
 * The phone number is deliberately NOT writable here even though the design
 * shows it as an input: `agents.phone` is this account's login identity and
 * its verified state (phone_verified_at) is what puts the "Numéro vérifié"
 * badge on the public page. Changing it is a re-verification flow with a
 * real OTP, not a text field on a settings form — the page renders it
 * read-only and says so.
 */
export async function updateAgentIdentityAction(formData) {
  const agentId = await assertAgentSession();

  const firstName = String(formData.get('first_name') || '').trim().slice(0, 120);
  const lastName = String(formData.get('last_name') || '').trim().slice(0, 120);
  const bio = String(formData.get('bio') || '').trim().slice(0, 2000);

  if (!firstName && !lastName) redirect('/compte/agent/parametres?error=name_required');

  const agent = await getAgentProfile(agentId);
  if (!agent) throw new Error('Not authenticated');

  await updateAgentIdentity(agentId, { firstName, lastName, bio, vendorId: agent.vendor_id });

  revalidatePath('/compte/agent/parametres');
  revalidatePath('/compte/agent');
  revalidatePath(`/agents/${agentId}`);
  redirect('/compte/agent/parametres?saved=identity');
}

/**
 * Real change-password flow: verifies the current password against
 * agents.password_hash before writing a new one (resetAgentPassword is
 * otherwise only reachable via the OTP-verified "mot de passe oublié"
 * flow). Bumping token_version invalidates every session including this
 * one, so a fresh session cookie is re-issued immediately after — a
 * successful password change should not also log the agent out.
 */
export async function changeAgentPasswordAction(formData) {
  const agentId = await assertAgentSession();
  const currentPassword = String(formData.get('current_password') || '');
  const newPassword = String(formData.get('new_password') || '');
  const confirmPassword = String(formData.get('confirm_password') || '');

  if (newPassword.length < 8) redirect('/compte/agent/parametres?error=too_short');
  if (newPassword !== confirmPassword) redirect('/compte/agent/parametres?error=mismatch');

  const agent = await getAgentAuthById(agentId);
  if (!agent || !verifyPasswordAgainstHash(currentPassword, agent.password_hash)) {
    redirect('/compte/agent/parametres?error=wrong_password');
  }

  await resetAgentPassword(agentId, hashPassword(newPassword));
  await establishAgentSession({ id: agentId, tokenVersion: agent.token_version + 1 });
  revalidatePath('/compte/agent/parametres');
  redirect('/compte/agent/parametres?success=1');
}
