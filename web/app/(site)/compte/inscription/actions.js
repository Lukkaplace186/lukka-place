'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { normalizePhone, phoneFromForm } from '@/lib/phone';
import { clientKey, rateLimited } from '@/lib/eventIngest';
import {
  getCustomerByPhone,
  createCustomer,
  mergeAnonymousData,
} from '@/lib/customers';
import { hashPasswordAsync } from '@/lib/customerAuth';
import { establishCustomerSession, rememberCustomerPhone } from '@/lib/customerSession';
import { recordWebSignupAttribution } from '@/lib/accountAcquisition';
import { normalisePartnerCode } from '@/lib/partnerRules';
import { findActivePartnerByCode } from '@/lib/partners';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import { parseMoveProject } from '@/lib/moveProjectRules';
import { saveProjectAndAlert } from '@/lib/moveProjects';
import { getT } from '@/lib/i18n/server';
import { recordSignupOutcome } from '@/lib/signupFunnel';

// Shared connections (a carrier's NAT) carry many people: generous, still far
// from enough to walk a list of numbers.
const SIGNUP_CHECKS_PER_MINUTE = 60;

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/client');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/client';
}

/** The hidden `moveProject` field (components/MoveOnboarding.js), validated. */
function parseMoveProjectField(value) {
  let raw = {};
  try {
    raw = JSON.parse(String(value || '{}'));
  } catch {
    raw = {};
  }
  return parseMoveProject(raw);
}

function parseAnonymousData(formData) {
  const favoriteIdsRaw = String(formData.get('favoriteIds') || '');
  const favoriteIds = favoriteIdsRaw ? favoriteIdsRaw.split(',').filter(Boolean) : [];
  let savedSearches = [];
  try {
    savedSearches = JSON.parse(String(formData.get('savedSearches') || '[]'));
  } catch {
    savedSearches = [];
  }
  return { favoriteIds, savedSearches };
}

/**
 * What the customer typed, sent back with a refusal so the form keeps it
 * (2026-11-08: a refused sign-up used to reload the card with name and number
 * blank). The password is never sent back; the form keeps it in its own state.
 */
function typedValues(formData) {
  return {
    fullName: String(formData.get('fullName') || '').slice(0, 120),
    phone: String(formData.get('phone') || '').slice(0, 30),
    phoneCountry: String(formData.get('phoneCountry') || '').slice(0, 2),
    partnerCode: String(formData.get('partner_code') || '').slice(0, 20),
  };
}

/**
 * A refusal, recorded in the sign-up funnel with its reason (2026-11-11):
 * which field sends people back is the friction the dashboard has to show.
 */
async function refuse(error, formData) {
  await recordSignupOutcome({ step: 'refused', entry: formData.get('entry'), refusal: error });
  return { error, values: typedValues(formData), attempt: Date.now() };
}

/**
 * Creates the account and signs the customer in. Number, name and password,
 * nothing else (2026-11-06, owner decision: every extra step lost customers).
 * Nothing proves the number belongs to whoever typed it; the owner accepted
 * that. A mistyped number is fixed by deleting the account and signing up
 * again; someone else's number is reclaimed by its owner through
 * "Mot de passe oublié", whose code goes to that WhatsApp.
 *
 * A useActionState action: a refusal RETURNS `{ error, values }` (the form
 * stays filled); success redirects.
 */
export async function signupAction(_prevState, formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = phoneFromForm(formData);

  // A name is required (owner decision, 2026-11-04): agents call the
  // customer back, and "Bonjour," with no name is how a lead goes cold.
  if (fullName.length < 2) return refuse('name', formData);
  if (!phone) return refuse('phone', formData);

  // Minimal length check, no policy engine — matches this app's low-ceremony
  // posture (adminAuth.js has no password policy either).
  if (password.length < 8) return refuse('password', formData);

  const existing = await getCustomerByPhone(phone);
  if (existing) return refuse('exists', formData);

  // The optional "Code de parrainage" (an agent's, a creator's): a code that
  // is not a live partner's is sent back BEFORE the account exists, so the
  // person can correct it or clear the field. A lookup that fails never
  // blocks signup.
  const typedCode = String(formData.get('partner_code') || '').trim().slice(0, 20);
  if (typedCode) {
    let known = null;
    try {
      known = normalisePartnerCode(typedCode) ? await findActivePartnerByCode(typedCode) : null;
    } catch (err) {
      console.error(`[customer-auth] partner code check failed, signing up without it: ${err.message}`);
      known = true;
    }
    if (!known) return refuse('ref', formData);
  }

  // Two taps, or two tabs, can both pass the "exists" check above; the
  // UNIQUE phone column refuses the second, which reads as "account exists"
  // rather than an error page (2026-11-07, before the campaign).
  let customer;
  try {
    customer = await createCustomer({ phone, passwordHash: await hashPasswordAsync(password), fullName });
  } catch (err) {
    if (err.code === '23505') return refuse('exists', formData);
    throw err;
  }

  // Where the account came from and which partner's link brought it
  // (lib/accountAcquisition.js). Never throws.
  await recordWebSignupAttribution({ accountType: 'customer', accountId: Number(customer.id), phone, typedCode: typedCode || null });
  // The sign-up funnel's last step, with the entry it started from. Never throws.
  await recordSignupOutcome({ step: 'created', entry: formData.get('entry'), customerId: Number(customer.id) });

  // The visitor's own device state (favourites, saved searches) joins the
  // new account.
  const { favoriteIds, savedSearches } = parseAnonymousData(formData);
  if (favoriteIds.length > 0 || savedSearches.length > 0) {
    await mergeAnonymousData(customer.id, { favoriteIds, savedSearches });
  }

  // "Mon déménagement" (2026-11-07): what the customer said on the cards
  // before this one becomes their project and an alert. Never blocks the
  // account (saveProjectAndAlert never throws).
  const { project, hasAnswers } = parseMoveProjectField(formData.get('moveProject'));
  let projectHref = null;
  if (hasAnswers) {
    const { saved, id, alert } = await saveProjectAndAlert(Number(customer.id), project, await getT());
    console.log(`[move-project] signup customer #${customer.id} saved=${saved} project=${id ?? 'none'} alert=${alert || 'none'} steps=${project.answeredSteps.length}`);
    if (saved && id != null) projectHref = `/compte/client/projet/${id}?nouveau=1`;
  }

  // Signed in, done: number + password is the whole signup (2026-11-06,
  // owner decision). No code is sent and no verification page follows.
  await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });
  await rememberCustomerPhone(phone);
  // The ad platforms' CompleteRegistration used to fire at the code step,
  // which no longer exists: an account created is a registration completed.
  await recordAdEventFromAction({ name: 'CompleteRegistration', eventId: `reg-c-${customer.id}`, phone });

  // Someone who told us about their move lands on it, with the homes that
  // match — unless a gate sent them here from somewhere they want to return to.
  redirect(projectHref && next === '/compte/client' ? projectHref : next);
}

/**
 * "Ce numéro a déjà un compte" as soon as the number is typed (2026-11-08):
 * someone who already has an account used to answer every card and learn it
 * on the last one. Says no more than the sign-up refusal itself already
 * says, and is rate-limited per connection so it cannot list accounts.
 *
 * @returns {Promise<{exists: boolean}>}
 */
export async function checkSignupPhoneAction(rawPhone, country) {
  const phone = normalizePhone(String(rawPhone || ''), String(country || ''));
  if (!phone) return { exists: false };
  const key = clientKey({ headers: await headers() });
  if (rateLimited(`signup-phone-check:${key}`, SIGNUP_CHECKS_PER_MINUTE)) return { exists: false };
  try {
    return { exists: Boolean(await getCustomerByPhone(phone)) };
  } catch {
    return { exists: false };
  }
}

/**
 * "Se connecter avec ce numéro": the sign-in page opens with that number
 * already in place (the remembered-number cookie, never the URL), and, when
 * the customer answered the move cards, it saves those answers once they are
 * signed in (`?apres=projet`, read by the login form from this device's draft).
 */
export async function signInWithNumberAction(formData) {
  const next = safeNext(formData.get('next'));
  const phone = phoneFromForm(formData);
  if (phone) await rememberCustomerPhone(phone);
  const params = new URLSearchParams({ next });
  if (formData.get('withProject') === '1') params.set('apres', 'projet');
  redirect(`/compte/connexion?${params.toString()}`);
}
