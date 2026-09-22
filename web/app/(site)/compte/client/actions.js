'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  getCurrentCustomerId,
  getCustomerById,
  addFavorite,
  addSavedSearch,
  removeFavorite,
  removeSavedSearch,
  updateCustomerName,
  updateSavedSearchPreferences,
  setWhatsAppAlertsOptOut,
  setFavoriteNote,
} from '@/lib/customers';
import {
  createLead,
  getLead,
  updateLeadRequirements,
  customerRespondToViewing,
  customerViewingCheckin,
  customerViewingFalloffReason,
} from '@/lib/adminApi';
import { VIEWING_CHECKIN_RESPONSES, VIEWING_FALLOFF_REASON_CODES } from '@/lib/viewingTimeline';
import { buildRequirementsSummary } from '@/lib/customerPortal';
import { MAX_REQUEST_COMMUNES } from '@/lib/leadCommunes';
import { ALERT_FREQUENCIES, MAX_ALERT_LABEL_LENGTH } from '@/lib/alertPreferences';
import { getT } from '@/lib/i18n/server';

/**
 * Server actions for the Espace Client portal.
 *
 * Every one of these resolves the customer id from the session cookie
 * itself (getCurrentCustomerId) and never from a form field — a
 * client-supplied id would let one customer mutate another's favorites,
 * searches or profile. Same non-negotiable binding rule the buyer
 * assistant's tool-calling layer follows (root CLAUDE.md).
 */

async function requireCustomerId() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client');
  return customerId;
}

/** A form post or a bare value — the boards call these imperatively now. */
function fieldFrom(input, name) {
  return typeof FormData !== 'undefined' && input instanceof FormData ? input.get(name) : input;
}

function revalidateSaved() {
  // '/compte/client/favoris' and '/compte/client/alertes' are redirects to
  // '/compte/client' (the merged Favoris & Alertes tab), so revalidating the
  // real route is what matters. The public /favoris page reads the same rows
  // for a signed-in visitor.
  revalidatePath('/compte/client');
  revalidatePath('/favoris');
}

/**
 * Returns `{ ok }` rather than nothing: FavoritesBoard hides the card before
 * this runs (the remove feels instant) and needs to know whether to put it
 * back. Accepts FormData too, for any form still posting here.
 */
export async function removeFavoriteAction(input) {
  const customerId = await requireCustomerId();
  const propertyId = Number.parseInt(String(fieldFrom(input, 'propertyId') ?? ''), 10);
  if (!Number.isFinite(propertyId)) return { ok: false };

  try {
    await removeFavorite(customerId, propertyId);
  } catch (error) {
    console.warn('[compte/client] removeFavoriteAction failed:', error.message);
    return { ok: false };
  }
  revalidateSaved();
  return { ok: true };
}

/** A private note on one of their saved listings. Empty clears it. */
export async function saveFavoriteNoteAction(propertyIdInput, note) {
  const customerId = await requireCustomerId();
  const propertyId = Number.parseInt(String(propertyIdInput ?? ''), 10);
  if (!Number.isFinite(propertyId)) return { ok: false };
  try {
    const saved = await setFavoriteNote(customerId, propertyId, note);
    if (!saved) return { ok: false };
  } catch (error) {
    console.warn('[compte/client] saveFavoriteNoteAction failed:', error.message);
    return { ok: false };
  }
  revalidatePath('/compte/client');
  return { ok: true };
}

/** The toast's "Annuler" after a remove. Subject to the same ceiling as any save. */
export async function restoreFavoriteAction(propertyIdInput) {
  const customerId = await requireCustomerId();
  const propertyId = Number.parseInt(String(propertyIdInput ?? ''), 10);
  if (!Number.isFinite(propertyId)) return { ok: false };

  try {
    const status = await addFavorite(customerId, propertyId);
    if (status === 'limit') return { ok: false, reason: 'limit' };
  } catch (error) {
    console.warn('[compte/client] restoreFavoriteAction failed:', error.message);
    return { ok: false };
  }
  revalidateSaved();
  return { ok: true };
}

export async function removeSavedSearchAction(input) {
  const customerId = await requireCustomerId();
  const query = String(fieldFrom(input, 'query') ?? '');
  if (!query) return { ok: false };

  try {
    await removeSavedSearch(customerId, query);
  } catch (error) {
    console.warn('[compte/client] removeSavedSearchAction failed:', error.message);
    return { ok: false };
  }
  revalidateSaved();
  revalidatePath('/compte/alertes');
  return { ok: true };
}

/**
 * Undo for a deleted alert. It comes back as a NEW row, so its "new since
 * your last visit" count restarts and the WhatsApp sweep only considers
 * listings published after the restore — nothing already sent is re-sent.
 */
export async function restoreSavedSearchAction({ query, label } = {}) {
  const customerId = await requireCustomerId();
  const cleanQuery = String(query || '').trim();
  const cleanLabel = String(label || '').trim();
  if (!cleanQuery || !cleanLabel) return { ok: false };

  try {
    const status = await addSavedSearch(customerId, { query: cleanQuery, label: cleanLabel });
    if (status === 'limit') return { ok: false, reason: 'limit' };
  } catch (error) {
    console.warn('[compte/client] restoreSavedSearchAction failed:', error.message);
    return { ok: false };
  }
  revalidateSaved();
  return { ok: true };
}

/**
 * Returns {ok} for ProfileNameForm's instant feedback (the field and the
 * greeting update on tap; a failure puts the old name back and says so).
 * Accepts FormData or a bare string.
 */
export async function updateProfileNameAction(input) {
  const customerId = await requireCustomerId();
  const fullName = String(fieldFrom(input, 'fullName') || '').trim();

  try {
    await updateCustomerName(customerId, fullName);
  } catch (error) {
    console.warn('[compte/client] updateProfileNameAction failed:', error.message);
    return { ok: false };
  }
  revalidatePath('/compte/client/parametres');
  revalidatePath('/compte/client');
  revalidatePath('/compte');
  return { ok: true };
}

/**
 * "Soumettre une recherche" — a real lead written to the engine's `leads`
 * table through the same POST /admin/leads every other visitor-initiated
 * inquiry already uses (agent-profile inquiry form). It lands in the admin
 * conversations/leads dashboard exactly like any other lead, and comes back
 * to the customer through getCustomerInquiries() scoped to their own phone.
 *
 * POST /admin/leads now also accepts the structured
 * `transaction_type`/`commune`/`price_min`/`price_max`/`bedrooms` columns
 * (the matching engine needs real columns to rank on, not just prose) — the
 * full free-text summary (buildRequirementsSummary) is still sent too, so
 * nothing the customer typed is lost. The form collects multiple communes
 * (checkboxes); only the single `commune` TEXT column exists, so the first
 * selected commune becomes the structured value and the complete list stays
 * in the summary for a human reading it.
 *
 * `wa_id` is the authenticated customer's own stored phone — already in the
 * digits-only shape the engine validates (lib/customerInquiries.js's doc
 * comment confirms this), never a value typed into the form.
 *
 * Returns a plain object for useActionState rather than throwing: the
 * engine being unreachable should show the customer a real error and keep
 * their typed input, not a Next.js error page.
 */
export async function submitPropertyRequestAction(_prevState, formData) {
  const t = await getT();
  const customerId = await requireCustomerId();
  const customer = await getCustomerById(customerId);
  if (!customer) redirect('/compte/connexion?next=/compte/client/demandes');

  const transactionType = String(formData.get('transactionType') || '');
  const communes = formData.getAll('communes').map(String).filter(Boolean);
  const bedrooms = String(formData.get('bedrooms') || '');
  const budgetMin = String(formData.get('budgetMin') || '');
  const budgetMax = String(formData.get('budgetMax') || '');
  const movingDate = String(formData.get('movingDate') || '').trim();
  const flexibility = String(formData.get('flexibility') || '');
  const notes = String(formData.get('notes') || '').trim();

  if (!transactionType) {
    return { status: 'error', message: t('errors.chooseBuyOrRent') };
  }
  if (communes.length === 0) {
    return { status: 'error', message: t('errors.selectAtLeastOneCommune') };
  }
  if (communes.length > MAX_REQUEST_COMMUNES) {
    return { status: 'error', message: t('errors.tooManyCommunes', { max: MAX_REQUEST_COMMUNES }) };
  }

  const requirementsSummary = buildRequirementsSummary({
    transactionType,
    communes,
    bedrooms,
    budgetMin,
    budgetMax,
    movingDate,
    flexibility,
    notes,
  });

  const parsedBedrooms = Number.parseInt(bedrooms, 10);
  const parsedBudgetMin = Number.parseFloat(budgetMin);
  const parsedBudgetMax = Number.parseFloat(budgetMax);

  let leadId = null;
  try {
    const { lead } = await createLead({
      waId: customer.phone,
      name: customer.full_name || null,
      source: 'espace-client-request',
      requirementsSummary,
      transactionType,
      // The whole list: the engine pushes the request to agencies covering
      // each commune. Only the first used to be sent, so every other
      // commune's agencies never heard about it.
      commune: communes[0],
      communes,
      priceMin: Number.isFinite(parsedBudgetMin) ? parsedBudgetMin : null,
      priceMax: Number.isFinite(parsedBudgetMax) ? parsedBudgetMax : null,
      bedrooms: Number.isFinite(parsedBedrooms) ? parsedBedrooms : null,
    });
    leadId = lead?.id ?? null;
  } catch (error) {
    console.warn('[compte/client] submitPropertyRequestAction failed:', error.message);
    return {
      status: 'error',
      message: t('errors.requestNotSent'),
    };
  }

  revalidatePath('/compte/client/demandes');
  revalidatePath('/compte/client/messages');
  revalidatePath('/compte/client');
  revalidatePath('/compte/demandes');

  // Hand the customer straight to the tab that tracks what they just sent,
  // rather than leaving them on the form under a green banner. The request
  // has one real next state — agencies answering it — and that state lives
  // on Messages & Visites; an inline "sent!" on the form was a dead end that
  // said nothing about what happens next.
  //
  // `?submitted=<id>` is what makes it a real hand-off rather than a plain
  // navigation: the destination opens ON that thread and confirms it by
  // number (./messages/page.js), instead of defaulting to whatever happens
  // to sort first. It is only ever a display hint — every thread rendered
  // there is still resolved server-side from the session's own phone, so a
  // hand-edited id can select nothing it wasn't already allowed to see.
  //
  // Outside the try/catch on purpose: redirect() signals by throwing, and a
  // throw inside that block would be caught and reported as a send failure
  // for a lead that was in fact created.
  redirect(leadId ? `/compte/client/messages?submitted=${leadId}` : '/compte/client/messages');
}

/**
 * "Modifier ma recherche" — a customer editing the structured fields on
 * their own already-submitted lead (Messages & Visites detail panel).
 * `leadId` alone is never enough authorization: it's re-fetched from the
 * engine and its own `wa_id` is checked against this session's real
 * `customer.phone` before any write — the same non-negotiable
 * server-side-only binding rule every other action here follows (a
 * client-supplied leadId must never let one customer edit another's lead).
 *
 * Returns a plain {ok, error} result rather than throwing/redirecting — it's
 * called imperatively from EditPropertyRequestDialog via useTransition, same
 * contract as markListingSoldAction (web/app/compte/agent/actions.js).
 */
export async function updatePropertyRequestAction(leadId, formData) {
  const t = await getT();
  const customerId = await requireCustomerId();
  const customer = await getCustomerById(customerId);
  if (!customer) redirect('/compte/connexion?next=/compte/client/messages');

  const numericLeadId = Number.parseInt(leadId, 10);
  if (!Number.isFinite(numericLeadId)) {
    return { ok: false, error: t('errors.requestNotFound') };
  }

  let lead;
  try {
    ({ lead } = await getLead(numericLeadId));
  } catch (error) {
    return { ok: false, error: t('errors.requestNotFound') };
  }
  if (!lead || lead.wa_id !== customer.phone) {
    return { ok: false, error: t('errors.requestNotYours') };
  }

  const transactionType = String(formData.get('transactionType') || '');
  // The edit dialog posts every selected commune; a lone `commune` field is
  // still read so an older open tab keeps working after a deploy.
  const postedCommunes = formData.getAll('communes').map(String).filter(Boolean);
  const communes = postedCommunes.length > 0
    ? postedCommunes
    : [String(formData.get('commune') || '')].filter(Boolean);
  const bedroomsRaw = String(formData.get('bedrooms') || '');
  const budgetMin = String(formData.get('budgetMin') || '');
  const budgetMax = String(formData.get('budgetMax') || '');
  const requirementsSummary = String(formData.get('requirementsSummary') || '').trim();

  if (!['vente', 'location'].includes(transactionType)) {
    return { ok: false, error: t('errors.chooseBuyOrRent') };
  }
  if (communes.length === 0) {
    return { ok: false, error: t('errors.selectACommune') };
  }
  if (communes.length > MAX_REQUEST_COMMUNES) {
    return { ok: false, error: t('errors.tooManyCommunes', { max: MAX_REQUEST_COMMUNES }) };
  }

  const parsedBedrooms = Number.parseInt(bedroomsRaw, 10);
  const parsedBudgetMin = Number.parseFloat(budgetMin);
  const parsedBudgetMax = Number.parseFloat(budgetMax);
  if (Number.isFinite(parsedBudgetMin) && Number.isFinite(parsedBudgetMax) && parsedBudgetMin > parsedBudgetMax) {
    return { ok: false, error: t('errors.budgetMinAboveMax') };
  }

  let proposalsReset = false;
  try {
    // The engine decides `proposals_reset` itself — by comparing this
    // lead's stored communes against the ones being written, never from
    // anything computed here — and clears every existing agent pitch when a
    // commune was REMOVED (routes/admin.js's PATCH /leads/:id). An added
    // commune keeps the proposals and pushes the request to that commune's
    // agencies instead.
    ({ proposals_reset: proposalsReset } = await updateLeadRequirements(numericLeadId, {
      transactionType,
      commune: communes[0],
      communes,
      priceMin: Number.isFinite(parsedBudgetMin) ? parsedBudgetMin : null,
      priceMax: Number.isFinite(parsedBudgetMax) ? parsedBudgetMax : null,
      bedrooms: Number.isFinite(parsedBedrooms) ? parsedBedrooms : null,
      requirementsSummary: requirementsSummary || null,
    }));
  } catch (error) {
    console.warn('[compte/client] updatePropertyRequestAction failed:', error.message);
    return { ok: false, error: t('errors.requestNotUpdated') };
  }

  revalidatePath('/compte/client/messages');
  revalidatePath('/compte/client/demandes');
  revalidatePath('/compte/client');

  return { ok: true, proposalsReset: Boolean(proposalsReset) };
}

// ---------------------------------------------------------------------------
// Visits — the customer's own answers on Messages & Visites. Each binds the
// account's stored phone as `wa_id`; the engine checks it against the
// request's lead and treats anybody else's id as not found. Every one returns
// {ok, message|error} for ViewingPanel's toast, never throws at it.
// ---------------------------------------------------------------------------

async function requireCustomerPhone() {
  const customerId = await requireCustomerId();
  const customer = await getCustomerById(customerId);
  if (!customer?.phone) redirect('/compte/connexion?next=/compte/client/messages');
  return customer.phone;
}

function viewingIdFrom(input) {
  const id = Number.parseInt(String(input ?? ''), 10);
  return Number.isFinite(id) ? id : null;
}

/** engineFetch throws the engine's own English error text; read it back into the customer's language. */
function visitErrorMessage(t, error) {
  const message = String(error?.message || '');
  if (/reviewed yet/i.test(message)) return t('account.visits.errors.notYet');
  if (/cannot be|not found|only/i.test(message)) return t('account.visits.errors.notAllowed');
  return t('account.visits.errors.failed');
}

async function runVisitAnswer(label, call) {
  const t = await getT();
  try {
    const message = await call(t);
    revalidatePath('/compte/client/messages');
    return { ok: true, message };
  } catch (error) {
    console.warn(`[compte/client] ${label} failed:`, error.message);
    return { ok: false, error: visitErrorMessage(t, error) };
  }
}

/**
 * Rename an alert or change how often it WhatsApps (Alertes tab). Returns
 * {ok, message|error} for AlertPreferences' toast. Before the preferences
 * migration the UPDATE fails, and the customer is told it did not save rather
 * than shown a setting that silently reverts.
 */
export async function updateAlertPreferencesAction(savedSearchId, { label, frequency } = {}) {
  const t = await getT();
  const customerId = await requireCustomerId();
  const id = Number.parseInt(String(savedSearchId ?? ''), 10);
  const patch = {};
  if (frequency !== undefined) {
    if (!ALERT_FREQUENCIES.includes(frequency)) return { ok: false, error: t('account.alerts.prefsFailed') };
    patch.frequency = frequency;
  }
  if (label !== undefined) {
    const clean = String(label).trim().slice(0, MAX_ALERT_LABEL_LENGTH);
    if (!clean) return { ok: false, error: t('account.alerts.prefsFailed') };
    patch.label = clean;
  }
  if (!Number.isFinite(id) || Object.keys(patch).length === 0) {
    return { ok: false, error: t('account.alerts.prefsFailed') };
  }

  try {
    const updated = await updateSavedSearchPreferences(customerId, id, patch);
    if (!updated) return { ok: false, error: t('account.alerts.prefsFailed') };
  } catch (error) {
    console.warn('[compte/client] updateAlertPreferencesAction failed:', error.message);
    return { ok: false, error: t('account.alerts.prefsFailed') };
  }
  revalidateSaved();
  return { ok: true, message: t('account.alerts.prefsSaved') };
}

/**
 * Account-wide WhatsApp alerts on/off (Mon profil's switch). Returns {ok}:
 * the switch flips on tap and flips back when this fails — it used to
 * swallow the error, so a failed save looked exactly like a successful one.
 * Accepts FormData (`enabled`) or a boolean.
 */
export async function setWhatsAppAlertsAction(input) {
  const customerId = await requireCustomerId();
  const raw = fieldFrom(input, 'enabled');
  const enabled = raw === true || String(raw ?? '') === '1';
  try {
    await setWhatsAppAlertsOptOut(customerId, !enabled);
  } catch (error) {
    console.warn('[compte/client] setWhatsAppAlertsAction failed:', error.message);
    return { ok: false };
  }
  revalidatePath('/compte/client/parametres');
  revalidatePath('/compte/client');
  return { ok: true };
}

// The callbacks below receive runVisitAnswer's translator as `translate`, not
// `t`: tests/unit/i18n-translator-binding.test.js reads each top-level
// function for a bound `t`, and a callback parameter is invisible to it.

export async function cancelViewingAction(viewingId) {
  const waId = await requireCustomerPhone();
  const id = viewingIdFrom(viewingId);
  return runVisitAnswer('cancelViewingAction', async (translate) => {
    if (id == null) throw new Error('not found');
    const result = await customerRespondToViewing(id, { waId, action: 'CANCEL' });
    // Only claim the agent was told when the engine says a message left.
    return translate(result.agentNotified ? 'account.visits.done.cancelled' : 'account.visits.done.cancelledQuiet');
  });
}

export async function acceptViewingSlotAction(viewingId) {
  const waId = await requireCustomerPhone();
  const id = viewingIdFrom(viewingId);
  return runVisitAnswer('acceptViewingSlotAction', async (translate) => {
    if (id == null) throw new Error('not found');
    const result = await customerRespondToViewing(id, { waId, action: 'ACCEPT_SLOT' });
    return translate(result.agentNotified ? 'account.visits.done.slotAccepted' : 'account.visits.done.slotAcceptedQuiet');
  });
}

export async function checkinViewingAction(viewingId, response) {
  const waId = await requireCustomerPhone();
  const id = viewingIdFrom(viewingId);
  return runVisitAnswer('checkinViewingAction', async (translate) => {
    if (id == null || !VIEWING_CHECKIN_RESPONSES.includes(response)) throw new Error('not found');
    await customerViewingCheckin(id, { waId, response });
    return translate('account.visits.done.feedback');
  });
}

export async function viewingFalloffReasonAction(viewingId, code) {
  const waId = await requireCustomerPhone();
  const id = viewingIdFrom(viewingId);
  return runVisitAnswer('viewingFalloffReasonAction', async (translate) => {
    if (id == null || !VIEWING_FALLOFF_REASON_CODES.includes(code)) throw new Error('not found');
    await customerViewingFalloffReason(id, { waId, code });
    return translate('account.visits.done.reason');
  });
}
