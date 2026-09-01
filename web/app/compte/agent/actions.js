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
  updateAgentImage,
  updateAgentCommunes,
  updateAgentWorkingHours,
} from '@/lib/agencies';
import { uploadAgentAvatar } from '@/lib/agentStorage';
import { uploadListingPhoto } from '@/lib/listingStorage';
import { createListing, attachListingPhotos } from '@/lib/agentListings';
import {
  listLeads,
  updateLeadStatus,
  sendWhatsAppMessage,
  listViewingRequests,
  updateViewingRequest,
  createLeadProposal,
} from '@/lib/adminApi';
import { LEAD_STATUSES, VIEWING_REQUEST_STATUSES } from '@/lib/adminLabels';
import { hasDemandFeedAccess } from '@/lib/demandFeed';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const MAX_LISTING_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_LISTING_PHOTOS = 10;
const ALLOWED_LISTING_PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// 'closed' is deliberately excluded here — it must only ever be reached via
// markListingSoldAction below, which requires a real sold_price alongside
// it. This action staying restricted to the two "still on the market"
// states is what makes that guarantee real rather than just a UI nicety
// (AgentListingStatusSelect simply not offering "closed" as an option).
const LISTING_STATUSES = ['active', 'under_offer'];

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
  // sold_price is cleared whenever the status moves away from 'closed' —
  // this action can no longer set 'closed' itself (see LISTING_STATUSES
  // above), but a listing already closed that gets reactivated shouldn't
  // keep a stale final price attached to what is now an active listing.
  const { rowCount } = await pool.query(
    `UPDATE properties SET listing_status = $1, sold_price = NULL, updated_at = NOW() WHERE id = $2 AND agent_id = $3`,
    [status, propertyId, agentId],
  );
  if (rowCount === 0) throw new Error('Not your listing, or it does not exist.');

  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent');
  revalidatePath(`/listings/${propertyId}`);
}

/**
 * The other, price-carrying way to reach listing_status = 'closed' — the
 * only way, per LISTING_STATUSES above. Ownership enforced the same way as
 * every other per-listing action here (AND agent_id = $n). Returns a result
 * object (not a redirect) since this is called imperatively from inside
 * MarkListingSoldDialog, which needs {ok, error} to keep the dialog open on
 * a validation failure and show a toast either way.
 */
export async function markListingSoldAction(propertyId, formData) {
  const agentId = await assertAgentSession();
  const soldPrice = Number.parseFloat(formData.get('sold_price'));
  if (!Number.isFinite(soldPrice) || soldPrice <= 0) {
    return { ok: false, error: 'Indiquez un prix final valide.' };
  }

  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties SET listing_status = 'closed', sold_price = $1, updated_at = NOW() WHERE id = $2 AND agent_id = $3`,
    [soldPrice, propertyId, agentId],
  );
  if (rowCount === 0) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent');
  revalidatePath(`/listings/${propertyId}`);
  return { ok: true };
}

/**
 * Manual listing creation (the agent-side equivalent of the WhatsApp intake
 * bot's syncListingToPostgres) — writes via lib/agentListings.js so this
 * action stays focused on auth/validation. `validCommunes`/`validCategories`
 * are bound at render time from the same DB-backed lists the form's selects
 * are built from (same allow-list pattern as updateOwnCommunesAction): a
 * crafted request still can't smuggle in an invented commune or category.
 *
 * Returns {ok, propertyId, photoWarning?} | {ok: false, error} — called
 * imperatively from CreateListingDialog, same reasoning as
 * uploadAgentAvatarAction (the dialog needs to stay open and show the real
 * error on failure, not navigate away).
 */
export async function createListingAction(validCommunes, validCategories, formData) {
  const agentId = await assertAgentSession();

  const title = String(formData.get('title') || '').trim().slice(0, 150);
  const description = String(formData.get('description') || '').trim().slice(0, 4000);
  const purpose = String(formData.get('purpose') || '');
  const commune = String(formData.get('commune') || '');
  const categoryId = Number.parseInt(formData.get('category_id'), 10);
  const price = Number.parseFloat(formData.get('price'));
  const bedsRaw = formData.get('beds');
  const bathRaw = formData.get('bath');
  const beds = bedsRaw ? Number.parseInt(bedsRaw, 10) : null;
  const bath = bathRaw ? Number.parseInt(bathRaw, 10) : null;
  const photos = formData.getAll('photos').filter((f) => f && typeof f !== 'string' && f.size > 0);

  if (!title) return { ok: false, error: 'Le titre est obligatoire.' };
  if (description.length < 15) return { ok: false, error: 'La description doit contenir au moins 15 caractères.' };
  if (!['rent', 'sale'].includes(purpose)) return { ok: false, error: 'Choisissez « Louer » ou « Vendre ».' };
  if (!new Set(validCommunes).has(commune)) return { ok: false, error: 'Commune invalide.' };
  const category = validCategories.find((c) => c.id === categoryId);
  if (!category) return { ok: false, error: 'Type de bien invalide.' };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Indiquez un prix valide.' };
  if (beds !== null && (!Number.isFinite(beds) || beds < 0)) return { ok: false, error: 'Nombre de chambres invalide.' };
  if (bath !== null && (!Number.isFinite(bath) || bath < 0)) return { ok: false, error: 'Nombre de salles de bain invalide.' };
  if (!photos.length) return { ok: false, error: 'Ajoutez au moins une photo.' };
  if (photos.length > MAX_LISTING_PHOTOS) return { ok: false, error: `Maximum ${MAX_LISTING_PHOTOS} photos.` };
  for (const file of photos) {
    if (!ALLOWED_LISTING_PHOTO_TYPES[file.type]) return { ok: false, error: 'Format de photo non supporté (JPEG, PNG ou WebP uniquement).' };
    if (file.size > MAX_LISTING_PHOTO_BYTES) return { ok: false, error: 'Une photo dépasse 5 Mo.' };
  }

  const agent = await getAgentProfile(agentId);
  if (!agent) throw new Error('Not authenticated');

  const propertyId = await createListing({
    agentId,
    vendorId: agent.vendor_id || 0,
    category,
    title,
    description,
    commune,
    price,
    purpose,
    beds,
    bath,
  });

  let uploadedCount = 0;
  try {
    const urls = [];
    for (const file of photos) {
      const buffer = Buffer.from(await file.arrayBuffer());
      urls.push(await uploadListingPhoto(buffer, propertyId, ALLOWED_LISTING_PHOTO_TYPES[file.type]));
    }
    uploadedCount = urls.length;
    await attachListingPhotos(propertyId, urls);
  } catch (err) {
    console.error(`[compte/agent] photo upload failed for new listing #${propertyId}: ${err.message}`);
  }

  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent');

  return { ok: true, propertyId, photoWarning: uploadedCount < photos.length };
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
 * Same ownership shape as assertOwnedLead, for the Visit Scheduler —
 * viewing_requests carries no agent column of its own (see
 * services/db.js's listViewingRequestsForOwner doc comment, engine repo),
 * so "this agent's own visit requests" is derived the same
 * property_ids-OR-assigned_agent way, one hop through the parent lead.
 */
async function assertOwnedViewingRequest(agentId, viewingRequestId) {
  const [agent, listings] = await Promise.all([getAgentProfile(agentId), getOwnListingsForDashboard(agentId)]);
  const propertyIds = listings.map((l) => l.id);
  const displayName = agentDisplayName(agent);
  const { data } =
    propertyIds.length || displayName
      ? await listViewingRequests({ propertyIds, assignedAgent: displayName || undefined, limit: 200 })
      : { data: [] };

  const viewingRequest = data.find((v) => v.id === viewingRequestId);
  if (!viewingRequest) throw new Error('Not your viewing request, or it does not exist.');
  return viewingRequest;
}

/**
 * Backs "Confirmer" / "Annuler" / "Reprogrammer" on AgentVisitRequestCard.
 * Called imperatively (not a plain <form action>) so the card can show a
 * toast and stay in place instead of navigating, per this feature's ask —
 * unlike updateAgentLeadStatusAction above, which still uses this page's
 * older redirect+searchParams convention.
 *
 * `requested_time` is only meaningful (and only read) alongside
 * status='RESCHEDULED' — confirming or cancelling never touches it.
 */
export async function updateViewingRequestAction(viewingRequestId, formData) {
  const agentId = await assertAgentSession();
  const status = String(formData.get('status') || '');
  if (!VIEWING_REQUEST_STATUSES.includes(status)) {
    return { ok: false, error: `status must be one of: ${VIEWING_REQUEST_STATUSES.join(', ')}` };
  }

  const requestedTime = status === 'RESCHEDULED' ? String(formData.get('requested_time') || '').trim() : undefined;
  if (status === 'RESCHEDULED' && !requestedTime) {
    return { ok: false, error: 'Indiquez le nouveau créneau proposé.' };
  }

  try {
    await assertOwnedViewingRequest(agentId, viewingRequestId);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  await updateViewingRequest(viewingRequestId, { status, requestedTime });
  revalidatePath('/compte/agent/visites');
  revalidatePath('/compte/agent');
  return { ok: true, status };
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

/**
 * Called imperatively from AgentAvatarUpload (not a plain <form action>), so
 * it returns a result object instead of redirecting — the client needs to
 * read {ok, url|error} to drive its instant preview/toast without a full
 * page navigation, unlike every other action on this page.
 */
export async function uploadAgentAvatarAction(formData) {
  const agentId = await assertAgentSession();
  const file = formData.get('avatar');

  if (!file || typeof file === 'string') return { ok: false, error: 'Aucun fichier reçu.' };
  if (!ALLOWED_AVATAR_TYPES[file.type]) {
    return { ok: false, error: 'Format non supporté (JPEG, PNG ou WebP uniquement).' };
  }
  if (file.size > MAX_AVATAR_BYTES) return { ok: false, error: 'Fichier trop volumineux (5 Mo max).' };

  const buffer = Buffer.from(await file.arrayBuffer());
  let url;
  try {
    url = await uploadAgentAvatar(buffer, agentId, ALLOWED_AVATAR_TYPES[file.type]);
  } catch (err) {
    console.error(`[compte/agent] avatar upload failed for agent #${agentId}: ${err.message}`);
    return { ok: false, error: "Échec de l'envoi. Réessayez." };
  }

  await updateAgentImage(agentId, url);
  revalidatePath('/compte/agent/parametres');
  revalidatePath('/compte/agent');
  revalidatePath(`/agents/${agentId}`);
  return { ok: true, url };
}

/**
 * Same allow-list validation as the admin's updateAgentCommunesAction
 * (web/app/admin/agents/actions.js) — communes only ever come from the real
 * canonical list, never free text — but the agent id comes from
 * assertAgentSession() rather than a bound/client-suppliable argument, so an
 * agent can only ever write their own row. Only the option list (validCommunes)
 * is bound at render time.
 */
export async function updateOwnCommunesAction(validCommunes, formData) {
  const agentId = await assertAgentSession();
  const validSet = new Set(validCommunes);
  const selected = formData.getAll('communes').filter((c) => validSet.has(c));

  await updateAgentCommunes(agentId, selected);
  revalidatePath('/compte/agent/parametres');
  revalidatePath(`/agents/${agentId}`);
  redirect('/compte/agent/parametres?saved=communes');
}

export async function updateWorkingHoursAction(formData) {
  const agentId = await assertAgentSession();
  const workingHours = String(formData.get('working_hours') || '').trim().slice(0, 200);

  await updateAgentWorkingHours(agentId, workingHours);
  revalidatePath('/compte/agent/parametres');
  revalidatePath(`/agents/${agentId}`);
  redirect('/compte/agent/parametres?saved=hours');
}

/**
 * Agent Demand Feed's "Proposer un bien". Called imperatively (not a plain
 * <form action>) so the card can show a toast and stay in place, same
 * pattern as markListingSoldAction/createListingAction. Re-checks feed
 * access and listing ownership server-side — the client-side locked state
 * and "my own listings only" dropdown are UX, not the real gate.
 */
export async function proposeListingAction(leadId, formData) {
  const agentId = await assertAgentSession();

  const agent = await getAgentProfile(agentId);
  if (!agent || !hasDemandFeedAccess(agent)) {
    return { ok: false, error: "Votre accès au flux de demandes n'est plus actif." };
  }

  const propertyId = Number.parseInt(formData.get('property_id'), 10);
  if (!Number.isFinite(propertyId)) {
    return { ok: false, error: 'Choisissez un bien à proposer.' };
  }

  const listings = await getOwnListingsForDashboard(agentId);
  // properties.id is a Postgres bigint — node-postgres returns it as a
  // string, so a bare === against the parsed-int propertyId always failed
  // here (caught live: every real pitch attempt returned "not available"
  // regardless of the listing's real status). Number(l.id) fixes the
  // comparison; same bug class as CreateListingDialog's category-id mismatch
  // from an earlier session.
  const listing = listings.find(
    (l) => Number(l.id) === propertyId && l.approve_status === 1 && l.listing_status === 'active',
  );
  if (!listing) {
    return { ok: false, error: "Ce bien n'est pas disponible (il doit être publié et actif)." };
  }

  try {
    await createLeadProposal({ leadId, agentId, propertyId });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  revalidatePath('/compte/agent/demandes');
  return { ok: true };
}
