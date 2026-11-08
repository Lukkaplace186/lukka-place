'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import {
  getCustomerByPhone,
  clearFailedLoginsAndTouchLogin,
  recordFailedLogin,
  mergeAnonymousData,
  consumeCustomerOtp,
} from '@/lib/customers';
import {
  verifyPasswordAgainstHashAsync,
  burnConstantTimeAsync,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_MS,
} from '@/lib/customerAuth';
import { establishCustomerSession, rememberCustomerPhone } from '@/lib/customerSession';
import { consumeProofAtLogin } from '@/lib/whatsappVerify';
import { parseMoveProject } from '@/lib/moveProjectRules';
import { saveProjectAndAlert } from '@/lib/moveProjects';
import { getT } from '@/lib/i18n/server';

/**
 * A refusal comes back as state with what was typed (2026-11-08: a failed
 * sign-in on a new phone used to empty the number field). The password stays
 * in the form's own state; it is never sent back.
 */
function refuse(error, formData) {
  return {
    error,
    values: { phone: String(formData.get('phone') || '').slice(0, 30), phoneCountry: String(formData.get('phoneCountry') || '').slice(0, 2) },
    attempt: Date.now(),
  };
}

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/client');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/client';
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || '{}')) || {};
  } catch {
    return {};
  }
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
 * Plain Server Action, matching the admin login's convention (errors via a
 * redirect + ?error= query param, not client state). The phone-not-found
 * and wrong-password paths both call a real scrypt comparison before
 * rejecting (burnConstantTime / verifyPasswordAgainstHash) so they cost the
 * same time and don't leak which case happened via response timing.
 */
export async function loginAction(_prevState, formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const phone = phoneFromForm(formData);

  if (!phone) return refuse('phone', formData);

  const customer = await getCustomerByPhone(phone);

  if (!customer) {
    await burnConstantTimeAsync(password);
    return refuse('1', formData);
  }

  if (customer.locked_until && new Date(customer.locked_until) > new Date()) return refuse('locked', formData);

  if (!(await verifyPasswordAgainstHashAsync(password, customer.password_hash))) {
    const failedCount = customer.failed_login_count + 1;
    const shouldLock = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS;
    await recordFailedLogin(customer.id, { lockUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null });
    return refuse(shouldLock ? 'locked' : '1', formData);
  }

  await clearFailedLoginsAndTouchLogin(customer.id);

  const { favoriteIds, savedSearches } = parseAnonymousData(formData);
  if (favoriteIds.length > 0 || savedSearches.length > 0) {
    await mergeAnonymousData(customer.id, { favoriteIds, savedSearches });
  }

  // A WhatsApp message the verify page never collected still proves the
  // number (lib/whatsappVerify.js consumeProofAtLogin): this login finishes
  // that verification.
  if (!customer.phone_verified_at && (await consumeProofAtLogin({ role: 'customer', id: customer.id, phone }))) {
    await consumeCustomerOtp(customer.id);
  }

  // Number + password is all a customer account needs (2026-11-06, owner
  // decision): no code, at login or anywhere else. Holding unconfirmed
  // customers at a code step on every login was the main reason they gave up
  // (13 of 30 web accounts never got past it). A forgotten password is reset
  // by a WhatsApp code (/mot-de-passe-oublie) or by the team (/admin/customers).
  await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });
  await rememberCustomerPhone(phone);

  // Came from sign-up's "Ce numéro a déjà un compte" after answering the move
  // cards (2026-11-08): those answers become a project now, instead of being
  // lost. saveProjectAndAlert never throws and refuses past 5 projects.
  const { project, hasAnswers } = parseMoveProject(parseJson(formData.get('moveProject')));
  if (hasAnswers) {
    const { saved, id } = await saveProjectAndAlert(Number(customer.id), project, await getT());
    console.log(`[move-project] login customer #${customer.id} saved=${saved} project=${id ?? 'none'}`);
    if (saved && id != null && next === '/compte/client') redirect(`/compte/client/projet/${id}?nouveau=1`);
  }

  redirect(next);
}
