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
import {
  createListing,
  attachListingPhotos,
  updateListing,
  updateListingPrice,
  setListingGallery,
  deleteListing,
  duplicateListing,
  getFeatureAmenities,
} from '@/lib/agentListings';
import { getCdfRate } from '@/lib/currencyRate';
import { convertCdfToUsd } from '@/lib/format';
import {
  listLeads,
  updateLeadStatus,
  sendWhatsAppMessage,
  listViewingRequests,
  updateViewingRequest,
  createLeadProposal,
  getAgentPitchUsage,
} from '@/lib/adminApi';
import { LEAD_STATUSES, VIEWING_REQUEST_STATUSES } from '@/lib/adminLabels';
import { currentQuotaPeriodStart, resolveLeadQuota } from '@/lib/leadQuota';
import { createPlanChangeRequest, getPurchasablePackages } from '@/lib/subscriptions';

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
  // sold_price/sold_at are cleared whenever the status moves away from
  // 'closed' — this action can no longer set 'closed' itself (see
  // LISTING_STATUSES above), but a listing already closed that gets
  // reactivated shouldn't keep a stale transaction attached to what is now
  // an active listing.
  //
  // `status = 1` (and archived_at = NULL) comes back with it: closing a
  // listing retires it from public search, so reopening it has to put it
  // back or "Remettre en ligne" would leave the agent with an active
  // listing nobody can find. An agent who wants it active-but-hidden
  // archives it explicitly afterwards.
  const { rowCount } = await pool.query(
    `UPDATE properties
     SET listing_status = $1, sold_price = NULL, sold_at = NULL,
         status = 1, archived_at = NULL, updated_at = NOW()
     WHERE id = $2 AND agent_id = $3`,
    [status, propertyId, agentId],
  );
  if (rowCount === 0) throw new Error('Not your listing, or it does not exist.');

  revalidateListingSurfaces(agentId, propertyId);
}

/**
 * The other, price-carrying way to reach listing_status = 'closed' — the
 * only way, per LISTING_STATUSES above. Ownership enforced the same way as
 * every other per-listing action here (AND agent_id = $n). Returns a result
 * object (not a redirect) since this is called imperatively from inside
 * MarkListingSoldDialog, which needs {ok, error} to keep the dialog open on
 * a validation failure and show a toast either way.
 *
 * Both halves of the transaction record are required, not optional:
 *
 *  - `sold_price` — the real agreed figure, which is what makes the
 *    institutional market export (lib/dataExport.js: asking vs achieved,
 *    price delta) mean anything. Without it a closed listing contributes
 *    nothing to the dataset.
 *  - `sold_at` — the real agreed DATE. Days-on-market was previously
 *    approximated from `updated_at`, which moves whenever anything on the
 *    row is edited; a listing touched three months after closing reported a
 *    three-month-longer DOM. A future date is rejected outright, and so is
 *    one before the listing existed.
 *
 * Closing also retires the listing from public search (`status = 0`). A
 * concluded transaction still appearing in results is the single most
 * common complaint against portals that don't do this, and the data is
 * fully preserved either way — this is the same reversible visibility flag
 * Archiver uses, not a delete.
 */
export async function markListingSoldAction(propertyId, formData) {
  const agentId = await assertAgentSession();
  const soldPrice = Number.parseFloat(formData.get('sold_price'));
  if (!Number.isFinite(soldPrice) || soldPrice <= 0) {
    return { ok: false, error: 'Indiquez un prix final valide.' };
  }

  const soldAtRaw = String(formData.get('sold_at') || '').trim();
  if (!soldAtRaw) return { ok: false, error: 'Indiquez la date de la transaction.' };
  const soldAt = new Date(`${soldAtRaw}T12:00:00Z`);
  if (Number.isNaN(soldAt.getTime())) return { ok: false, error: 'Date de transaction invalide.' };
  if (soldAt.getTime() > Date.now()) {
    return { ok: false, error: 'La date de transaction ne peut pas être dans le futur.' };
  }

  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT created_at FROM properties WHERE id = $1 AND agent_id = $2',
    [propertyId, agentId],
  );
  if (!rows.length) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };
  const createdAt = rows[0].created_at ? new Date(rows[0].created_at) : null;
  // Same-day close is legitimate, so this compares dates, not instants —
  // `created_at` is a timestamp and a listing published at 14:00 would
  // otherwise reject a transaction dated that morning.
  if (createdAt && soldAtRaw < createdAt.toISOString().slice(0, 10)) {
    return { ok: false, error: 'La date de transaction précède la publication de l’annonce.' };
  }

  const { rowCount } = await pool.query(
    `UPDATE properties
     SET listing_status = 'closed', sold_price = $1, sold_at = $2,
         status = 0, archived_at = NOW(), updated_at = NOW()
     WHERE id = $3 AND agent_id = $4`,
    [soldPrice, soldAtRaw, propertyId, agentId],
  );
  if (rowCount === 0) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  revalidateListingSurfaces(agentId, propertyId);
  return { ok: true };
}

/**
 * Archive / republish — "temporarily hide a listing from public search
 * without deleting the data".
 *
 * The mechanism is `properties.status`, the existing 0/1 active-enabled
 * integer flag that every public query already excludes (`status = 1 AND
 * approve_status = 1` — see CLAUDE.md). Nothing new is invented, and
 * nothing is destroyed: the row, its photos, its gallery, its amenity tags
 * and its stats all stay exactly where they were, and republishing is a
 * single UPDATE away.
 *
 * Deliberately independent of the three axes it sits beside:
 *   approve_status  moderation (admin owns it — archiving never launders an
 *                   unapproved listing into an approved one, and
 *                   republishing an unapproved listing still leaves it
 *                   invisible, correctly)
 *   listing_status  market state (active / under_offer / closed)
 *   status          visibility — this action, and only this action, on the
 *                   agent side
 *
 * `archived_at` records when, which is what lets the UI say "Archivée le
 * …" and lets /admin tell an agent-archived listing from one that was
 * never enabled in the first place.
 *
 * Republishing a *closed* listing is refused: a listing whose transaction
 * is recorded must go back through "Remettre en ligne" (which clears the
 * sold price and date), or the site would publish a property that our own
 * market dataset says is already sold.
 */
export async function setListingArchivedAction(propertyId, archived) {
  const agentId = await assertAgentSession();
  const pool = getPool();

  if (!archived) {
    const { rows } = await pool.query(
      'SELECT listing_status FROM properties WHERE id = $1 AND agent_id = $2',
      [propertyId, agentId],
    );
    if (!rows.length) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };
    if (rows[0].listing_status === 'closed') {
      return {
        ok: false,
        error: 'Ce bien est marqué loué / vendu. Utilisez « Remettre en ligne » pour rouvrir la transaction.',
      };
    }
  }

  const { rowCount } = await pool.query(
    `UPDATE properties
     SET status = $1, archived_at = $2, updated_at = NOW()
     WHERE id = $3 AND agent_id = $4`,
    [archived ? 0 : 1, archived ? new Date() : null, propertyId, agentId],
  );
  if (rowCount === 0) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  revalidateListingSurfaces(agentId, propertyId);
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
  // Both optional, and both deliberately normalised to null rather than a
  // placeholder: `area` is a TEXT column where '0' renders as "0 m²"
  // (see hasArea() in lib/listingView.js), so an unknown surface must stay
  // empty, not become a zero.
  const areaRaw = formData.get('area');
  const area = areaRaw ? Number.parseInt(areaRaw, 10) : null;
  const quartier = String(formData.get('quartier') || '').trim() || null;
  const photos = formData.getAll('photos').filter((f) => f && typeof f !== 'string' && f.size > 0);

  if (!title) return { ok: false, error: 'Le titre est obligatoire.' };
  if (description.length < 15) return { ok: false, error: 'La description doit contenir au moins 15 caractères.' };
  if (!['rent', 'sale'].includes(purpose)) return { ok: false, error: 'Choisissez « Louer » ou « Vendre ».' };
  if (!new Set(validCommunes).has(commune)) return { ok: false, error: 'Commune invalide.' };
  const category = validCategories.find((c) => c.id === categoryId);
  if (!category) return { ok: false, error: 'Type de bien invalide.' };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Indiquez un prix valide.' };
  if (area !== null && (!Number.isFinite(area) || area <= 0)) return { ok: false, error: 'Superficie invalide.' };
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
    area,
    quartier,
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

  revalidateListingSurfaces(agentId, propertyId);

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
  revalidatePath('/compte/agent/demandes');
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
 * An agent answering a customer request that was matched and pushed to them
 * — "je propose ce bien pour cette demande".
 *
 * This used to be the Agent Demand Feed's pitch button, reachable only by
 * browsing a marketplace of open requests. That feed is gone: the engine's
 * dispatcher now pushes a matching request to the best-ranked agencies on
 * WhatsApp the moment it's submitted, and this is what an agent does when
 * they act on one. The write is unchanged (a real `lead_proposals` row) —
 * only the way an agent arrives at it.
 *
 * Called imperatively (not a plain <form action>) so the card can show a
 * toast and stay in place, same pattern as markListingSoldAction. Re-checks
 * quota and listing ownership server-side — the client-side remaining count
 * and "my own listings only" dropdown are UX, not the real gate.
 */
export async function proposeListingAction(leadId, formData) {
  const agentId = await assertAgentSession();

  const agent = await getAgentProfile(agentId);
  if (!agent) {
    return { ok: false, error: 'Compte agent introuvable.' };
  }

  const propertyId = Number.parseInt(formData.get('property_id'), 10);
  if (!Number.isFinite(propertyId)) {
    return { ok: false, error: 'Choisissez un bien à proposer.' };
  }

  // Monthly quota, checked server-side before anything is written. The
  // client renders a remaining count too, but that is UX — this is the gate.
  // Usage is a real count of this agent's own lead_proposals rows since the
  // start of the month (the engine's SQLite owns that record); the allowance
  // is packages.monthly_pitch_limit. A quota lookup that fails does NOT
  // silently grant the response: the paid tiers' whole commercial model
  // depends on this limit, so an unreadable count is a refusal, not a free
  // pass.
  let quota;
  try {
    const { used } = await getAgentPitchUsage({ agentId, since: currentQuotaPeriodStart() });
    quota = resolveLeadQuota(agent, used);
  } catch (err) {
    console.warn(`[compte/agent] lead quota lookup failed for agent #${agentId}: ${err.message}`);
    return { ok: false, error: 'Impossible de vérifier votre quota du mois. Réessayez dans un instant.' };
  }
  if (quota.exhausted) {
    return {
      ok: false,
      error: `Vous avez traité vos ${quota.limit} demandes du mois. Le quota est réinitialisé le 1er du mois prochain.`,
    };
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
  revalidatePath('/compte/agent');
  // A pitch is immediately visible on the customer's own side — their
  // proposal cards live in Messages & Visites (compte/client/messages), fed
  // by the same lead_proposals rows this just wrote.
  revalidatePath('/compte/client/messages');
  revalidatePath('/compte/client');
  return { ok: true };
}

/**
 * Every public surface a listing's own content appears on. Called after
 * every native write below, so an agent's edit is live on the storefront
 * immediately rather than at the next natural revalidation — the whole
 * point of editing in-app instead of messaging the team on WhatsApp.
 *
 * `/listings` and `/` are included because a card there renders the title,
 * price and cover photo this editor can change; `/agents/[id]` is the
 * agent's own public portfolio page.
 */
function revalidateListingSurfaces(agentId, propertyId) {
  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent');
  revalidatePath('/listings');
  revalidatePath('/');
  revalidatePath(`/agents/${agentId}`);
  if (propertyId != null) {
    revalidatePath(`/compte/agent/biens/${propertyId}/edit`);
    revalidatePath(`/listings/${propertyId}`);
  }
}

/**
 * The native editor's save (/compte/agent/biens/[id]/edit).
 *
 * Ownership is enforced twice and neither check trusts the client: the
 * agent id comes from assertAgentSession(), and lib/agentListings.js's
 * updateListing carries `AND agent_id = $n` in the UPDATE itself, returning
 * false rather than silently writing nothing if they don't match.
 *
 * `validCommunes` is bound at render time from the same DB/engine-backed
 * list the form's select is built from — the same allow-list pattern
 * createListingAction and updateOwnCommunesAction already use, so a crafted
 * request can't smuggle in an invented commune (which would also write a
 * commune amenity tag that maps to nothing).
 *
 * Returns {ok, error?} rather than redirecting: the form calls it
 * imperatively so it can surface the real error inline and keep the agent's
 * unsaved input, same reasoning as createListingAction.
 */
export async function updateListingAction(propertyId, validCommunes, formData) {
  const agentId = await assertAgentSession();

  const title = String(formData.get('title') || '').trim().slice(0, 150);
  const description = String(formData.get('description') || '').trim().slice(0, 4000);
  const commune = String(formData.get('commune') || '');
  const quartier = String(formData.get('quartier') || '').trim().slice(0, 120) || null;
  const priceInput = Number.parseFloat(formData.get('price'));
  const currency = String(formData.get('currency') || 'USD').toUpperCase();

  const optionalInt = (key) => {
    const raw = formData.get(key);
    if (raw === null || String(raw).trim() === '') return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const beds = optionalInt('beds');
  const bath = optionalInt('bath');
  const unitsCount = optionalInt('units_count');
  const depositMonths = optionalInt('deposit_months');
  const areaRaw = formData.get('area');
  const areaNumber = String(areaRaw ?? '').trim() === '' ? null : Number.parseFloat(areaRaw);

  if (!title) return { ok: false, error: 'Le titre est obligatoire.' };
  if (description.length < 15) return { ok: false, error: 'La description doit contenir au moins 15 caractères.' };
  if (!new Set(validCommunes).has(commune)) return { ok: false, error: 'Commune invalide.' };
  if (!['USD', 'CDF'].includes(currency)) return { ok: false, error: 'Devise invalide.' };
  if (!Number.isFinite(priceInput) || priceInput <= 0) return { ok: false, error: 'Indiquez un prix valide.' };
  for (const [value, label] of [
    [beds, 'chambres'], [bath, 'salles de bain'], [unitsCount, 'portes'], [depositMonths, 'mois de garantie'],
  ]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      return { ok: false, error: `Nombre de ${label} invalide.` };
    }
  }
  if (areaNumber !== null && (!Number.isFinite(areaNumber) || areaNumber < 0)) {
    return { ok: false, error: 'Superficie invalide.' };
  }

  // `area` is a TEXT column that carries '0' rather than NULL when unknown
  // (web/CLAUDE.md's hasArea() gotcha) — writing '0' for a cleared field
  // keeps this listing consistent with every other row rather than
  // introducing a NULL the read path doesn't expect.
  const area = areaNumber === null || areaNumber === 0 ? '0' : String(areaNumber);

  // Dual-column currency. `price_original` is the agent's own figure, stored
  // verbatim in the currency they chose. `price` stays canonical USD, because
  // it is what every WHERE price >= / <=, ORDER BY price, MAX(price) and the
  // engine's budgetScore compare against — an FC number in that column would
  // sort above every USD listing and never match a budget filter.
  //
  // The rate is the same admin-editable, explicitly-dated figure the whole
  // site displays with (lib/currencyRate.js) — not a live FX feed, which is
  // exactly why the authored figure is preserved separately rather than being
  // the only record.
  let price = priceInput;
  if (currency === 'CDF') {
    const rate = await getCdfRate();
    price = convertCdfToUsd(priceInput, rate.cdfPerUsd);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: 'La conversion du prix en dollars a échoué. Réessayez.' };
    }
  }
  const priceOriginal = priceInput;

  // Feature amenities: only ids that really exist outside the 21-44 commune
  // block are accepted, resolved against the database rather than trusted
  // from the form — a commune id smuggled in here would silently relocate
  // the listing, since that same table stores its commune.
  let amenityIds;
  if (formData.get('amenities_touched') === '1') {
    const submitted = formData.getAll('amenities').map((v) => Number.parseInt(v, 10)).filter(Number.isFinite);
    const allowed = new Set((await getFeatureAmenities()).map((a) => a.id));
    amenityIds = submitted.filter((id) => allowed.has(id));
  }

  // Photos: `existing_photos` is the kept-and-reordered set the client sends
  // back (order matters — index 0 becomes the cover), `photos` are newly
  // uploaded files appended after them. The gallery is only rewritten when
  // the form actually submitted a photo section, so a save that never
  // touched photos leaves them completely alone.
  const keptPhotos = formData.getAll('existing_photos').map(String).filter(Boolean);
  const newFiles = formData.getAll('photos').filter((f) => f && typeof f !== 'string' && f.size > 0);
  const touchedPhotos = formData.get('photos_touched') === '1';

  // Every photo rule is checked BEFORE the field write below. Validating
  // them afterwards meant a rejected photo set returned {ok:false} on an
  // edit whose title/price/description had already been committed — the
  // agent saw "échec" and closed the form believing nothing had saved.
  if (touchedPhotos) {
    if (keptPhotos.length + newFiles.length === 0) {
      return { ok: false, error: 'Gardez au moins une photo.' };
    }
    if (keptPhotos.length + newFiles.length > MAX_LISTING_PHOTOS) {
      return { ok: false, error: `Maximum ${MAX_LISTING_PHOTOS} photos.` };
    }
    for (const file of newFiles) {
      if (!ALLOWED_LISTING_PHOTO_TYPES[file.type]) {
        return { ok: false, error: 'Format de photo non supporté (JPEG, PNG ou WebP uniquement).' };
      }
      if (file.size > MAX_LISTING_PHOTO_BYTES) return { ok: false, error: 'Une photo dépasse 5 Mo.' };
    }
  }

  const owned = await updateListing(agentId, propertyId, {
    title, description, commune, price, priceOriginal, currency, beds, bath, area, quartier,
    unitsCount, depositMonths, amenityIds,
  });
  if (!owned) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  let photoWarning = false;
  if (touchedPhotos) {
    const urls = [...keptPhotos];
    try {
      for (const file of newFiles) {
        const buffer = Buffer.from(await file.arrayBuffer());
        urls.push(await uploadListingPhoto(buffer, propertyId, ALLOWED_LISTING_PHOTO_TYPES[file.type]));
      }
    } catch (err) {
      console.error(`[compte/agent] photo upload failed for listing #${propertyId}: ${err.message}`);
      photoWarning = true;
    }
    // Written even on a partial upload failure: the kept/reordered photos
    // are a real, intended change and shouldn't be discarded because one
    // new file didn't make it to Storage.
    await setListingGallery(propertyId, urls);
  }

  revalidateListingSurfaces(agentId, propertyId);
  return { ok: true, photoWarning };
}

/**
 * Permanent delete, from the Mes biens actions menu. Irreversible and says
 * so in the UI, which requires typing nothing but does confirm in a real
 * dialog rather than a bare menu click.
 *
 * Deliberately returns {ok} instead of redirecting so the menu can show a
 * toast and let router.refresh() drop the row, matching every other
 * imperative action on this dashboard.
 */
export async function deleteListingAction(propertyId) {
  const agentId = await assertAgentSession();

  let deleted;
  try {
    deleted = await deleteListing(agentId, propertyId);
  } catch (err) {
    console.error(`[compte/agent] delete failed for listing #${propertyId}: ${err.message}`);
    // A listing already referenced by something this app doesn't own (a
    // lead's property_id lives in the engine's SQLite and has no FK, but
    // other Postgres tables may) surfaces as a real error rather than a
    // silent no-op.
    return { ok: false, error: "Ce bien n'a pas pu être supprimé. Contactez l'équipe Lukka Place." };
  }
  if (!deleted) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  revalidateListingSurfaces(agentId, propertyId);
  return { ok: true };
}

/** Duplicate one of this agent's listings into a fresh unpublished draft. */
export async function duplicateListingAction(propertyId) {
  const agentId = await assertAgentSession();

  const newId = await duplicateListing(agentId, propertyId);
  if (!newId) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  revalidateListingSurfaces(agentId, newId);
  return { ok: true, propertyId: newId };
}

/**
 * The Mes biens table's inline price cell (AgentListingsTable.js), backed
 * by lib/agentListings.js's narrower updateListingPrice — see that
 * function's own doc comment for why this doesn't reuse the full
 * updateListing() the native editor calls.
 *
 * Currency-aware the same way updateListingAction is: an FC figure is
 * converted to canonical USD at the current dated rate before being
 * written, and the agent's own authored figure is preserved verbatim in
 * price_original. Called imperatively (not a <form action>) so the client
 * can apply the value optimistically and roll it back on a real failure.
 */
export async function updateListingPriceAction(propertyId, formData) {
  const agentId = await assertAgentSession();

  const priceInput = Number.parseFloat(formData.get('price'));
  const currency = String(formData.get('currency') || 'USD').toUpperCase();

  if (!['USD', 'CDF'].includes(currency)) return { ok: false, error: 'Devise invalide.' };
  if (!Number.isFinite(priceInput) || priceInput <= 0) return { ok: false, error: 'Indiquez un prix valide.' };

  let price = priceInput;
  if (currency === 'CDF') {
    const rate = await getCdfRate();
    price = convertCdfToUsd(priceInput, rate.cdfPerUsd);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: 'La conversion du prix en dollars a échoué. Réessayez.' };
    }
  }

  const owned = await updateListingPrice(agentId, propertyId, { price, priceOriginal: priceInput, currency });
  if (!owned) return { ok: false, error: 'Bien introuvable, ou vous n’en êtes pas le propriétaire.' };

  revalidateListingSurfaces(agentId, propertyId);
  return { ok: true, price };
}

/**
 * Bulk "Marquer sous compromis" from the Mes biens floating selection bar.
 *
 * Deliberately NOT a bulk "Marquer comme loué / vendu": that status can
 * only be reached with a real final sale price (markListingSoldAction,
 * LISTING_STATUSES above), and there is no honest single price to apply
 * across a batch of different listings — collecting N real prices in one
 * bulk action is a materially different, larger feature than "select rows,
 * click a button", not a corner this action can safely cut. Moving several
 * listings to "sous compromis" together carries no such requirement, so
 * that is the real bulk status change offered here.
 *
 * Every id is still scoped through the per-row `AND agent_id = $n` inside
 * updateListingStatusAction's own query — a client-supplied id list can
 * only ever touch listings this agent actually owns.
 *
 * @param {number[]} propertyIds
 * @returns {Promise<{ok: boolean, updated: number, failed: number}>}
 */
export async function bulkMarkUnderOfferAction(propertyIds) {
  const agentId = await assertAgentSession();
  const ids = (propertyIds || []).map((id) => Number(id)).filter(Number.isFinite);

  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties SET listing_status = 'under_offer', sold_price = NULL, sold_at = NULL, updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND agent_id = $2 AND listing_status <> 'closed'`,
    [ids, agentId],
  );

  revalidateListingSurfaces(agentId, null);
  return { ok: true, updated: rowCount, failed: ids.length - rowCount };
}

/**
 * Bulk archive / republish, alongside bulkMarkUnderOfferAction above — an
 * agent clearing out a season's inventory shouldn't have to open a menu 20
 * times. Same rules as the single-listing setListingArchivedAction: closed
 * listings are excluded from a bulk republish (they must go back through
 * "Remettre en ligne", which clears the recorded transaction) rather than
 * silently skipped without saying so — the returned `failed` count is what
 * the toast reports.
 *
 * @param {number[]} propertyIds
 * @param {boolean} archived
 * @returns {Promise<{ok: boolean, updated: number, failed: number}>}
 */
export async function bulkSetArchivedAction(propertyIds, archived) {
  const agentId = await assertAgentSession();
  const ids = (propertyIds || []).map((id) => Number(id)).filter(Number.isFinite);
  if (ids.length === 0) return { ok: true, updated: 0, failed: 0 };

  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties
     SET status = $1, archived_at = $2, updated_at = NOW()
     WHERE id = ANY($3::bigint[]) AND agent_id = $4
       ${archived ? '' : "AND listing_status <> 'closed'"}`,
    [archived ? 0 : 1, archived ? new Date() : null, ids, agentId],
  );

  revalidateListingSurfaces(agentId, null);
  return { ok: true, updated: rowCount, failed: ids.length - rowCount };
}

/**
 * Bulk delete from the Mes biens floating selection bar — same real,
 * irreversible removal as deleteListingAction (child rows first, no
 * ON DELETE CASCADE on these tables), just applied to a selection. Runs the
 * per-listing helper sequentially rather than one batched statement so a
 * listing referenced elsewhere in a way that makes it fail doesn't abort
 * the rest of the selection — the caller gets an honest partial-success
 * count instead of an all-or-nothing failure.
 *
 * @param {number[]} propertyIds
 * @returns {Promise<{ok: boolean, deleted: number, failed: number}>}
 */
export async function bulkDeleteListingsAction(propertyIds) {
  const agentId = await assertAgentSession();
  const ids = (propertyIds || []).map((id) => Number(id)).filter(Number.isFinite);

  let deleted = 0;
  for (const id of ids) {
    try {
      if (await deleteListing(agentId, id)) deleted += 1;
    } catch (err) {
      console.error(`[compte/agent] bulk delete failed for listing #${id}: ${err.message}`);
    }
  }

  revalidateListingSurfaces(agentId, null);
  return { ok: true, deleted, failed: ids.length - deleted };
}


/**
 * An agent asking to move to a real plan, from their own dashboard.
 *
 * `packageId` is validated against the live list of *purchasable* packages
 * (status = 1) rather than trusted — the same allow-list posture
 * createListingAction takes with communes/categories. Without it a crafted
 * request could file a queue entry for a retired or hidden package, which an
 * admin would then be asked to honour.
 *
 * Returns {ok, created} rather than throwing: this is called imperatively
 * from AgentPlanPicker, which needs to distinguish "filed" from "you already
 * asked for this" and say so, instead of navigating away.
 */
export async function requestPlanChangeAction(packageId) {
  const agentId = await assertAgentSession();
  const id = Number.parseInt(packageId, 10);
  if (!Number.isFinite(id)) return { ok: false, error: 'Forfait invalide.' };

  const packages = await getPurchasablePackages();
  const target = packages.find((p) => p.id === id);
  if (!target) return { ok: false, error: "Ce forfait n'est pas disponible à la souscription." };

  try {
    const { created } = await createPlanChangeRequest({
      agentId,
      packageId: id,
      kind: 'upgrade',
      note: `Demande depuis l'espace agent — ${target.title}`,
    });
    revalidatePath('/compte/agent/abonnement');
    return { ok: true, created };
  } catch (err) {
    console.error(`[agent] plan change request failed for agent #${agentId}: ${err.message}`);
    return { ok: false, error: "Votre demande n'a pas pu être enregistrée. Réessayez dans un instant." };
  }
}
