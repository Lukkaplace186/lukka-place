'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import {
  getCustomerByPhone,
  createCustomer,
  mergeAnonymousData,
} from '@/lib/customers';
import { hashPassword } from '@/lib/customerAuth';
import { establishCustomerSession, rememberCustomerPhone } from '@/lib/customerSession';
import { recordWebSignupAttribution } from '@/lib/accountAcquisition';
import { normalisePartnerCode } from '@/lib/partnerRules';
import { findActivePartnerByCode } from '@/lib/partners';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import { parseMoveProject } from '@/lib/moveProjectRules';
import { saveProjectAndAlert } from '@/lib/moveProjects';
import { getT } from '@/lib/i18n/server';

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
 * Creates the account and signs the customer in. Number, name and password,
 * nothing else (2026-11-06, owner decision: every extra step lost customers).
 * Nothing proves the number belongs to whoever typed it; the owner accepted
 * that. A mistyped number is fixed by deleting the account and signing up
 * again; someone else's number is reclaimed by its owner through
 * "Mot de passe oublié", whose code goes to that WhatsApp.
 */
export async function signupAction(formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = phoneFromForm(formData);

  // A name is required (owner decision, 2026-11-04): agents call the
  // customer back, and "Bonjour," with no name is how a lead goes cold.
  if (fullName.length < 2) {
    redirect(`/compte/inscription?error=name&next=${encodeURIComponent(next)}`);
  }

  if (!phone) {
    redirect(`/compte/inscription?error=phone&next=${encodeURIComponent(next)}`);
  }

  // Minimal length check, no policy engine — matches this app's low-ceremony
  // posture (adminAuth.js has no password policy either).
  if (password.length < 8) {
    redirect(`/compte/inscription?error=password&next=${encodeURIComponent(next)}`);
  }

  const existing = await getCustomerByPhone(phone);
  if (existing) {
    redirect(`/compte/inscription?error=exists&next=${encodeURIComponent(next)}`);
  }

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
    if (!known) {
      redirect(`/compte/inscription?error=ref&next=${encodeURIComponent(next)}&code=${encodeURIComponent(typedCode)}`);
    }
  }

  const customer = await createCustomer({ phone, passwordHash: hashPassword(password), fullName });

  // Where the account came from and which partner's link brought it
  // (lib/accountAcquisition.js). Never throws.
  await recordWebSignupAttribution({ accountType: 'customer', accountId: Number(customer.id), phone, typedCode: typedCode || null });

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
