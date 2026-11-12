'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { phoneFromForm } from '@/lib/phone';
import { clientKey, rateLimited } from '@/lib/eventIngest';
import {
  clearFailedLoginsAndTouchLogin,
  consumeCustomerOtp,
  createCustomer,
  getCustomerAuthById,
  getCustomerByPhone,
  mergeAnonymousData,
} from '@/lib/customers';
import { establishCustomerSession, rememberCustomerPhone } from '@/lib/customerSession';
import { clearVerifyAttemptCookie, getVerifyAttempt, setVerifyAttemptCookie } from '@/lib/verifyAttempt';
import { consumeVerifiedChallenge } from '@/lib/whatsappVerify';
import { recordWebSignupAttribution } from '@/lib/accountAcquisition';
import { recordSignupOutcome } from '@/lib/signupFunnel';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import { safeSignInNext, cleanFullName, isNewAccount } from '@/lib/whatsappSignInRules';

/**
 * "Continuer avec WhatsApp" (UX pass 2026-11-12): sign in — or open an
 * account — by sending a code FROM the person's own WhatsApp, with no
 * password. It reuses the reverse proof the verify page already uses
 * (lib/whatsappVerify.js; the engine matches the code on the SENDER's number,
 * services/phoneChallenges.js), so typing someone else's number gets nowhere:
 * only a message from that number opens the session.
 *
 * An account is created for a number we do not know, with the name the
 * person typed and no password (customers.password_hash NULL, as for an
 * account opened on WhatsApp); they can set one later from Mon profil.
 */

const STARTS_PER_10_MIN = 10;

function refuse(error, formData, extra = {}) {
  return {
    error,
    values: {
      phone: String(formData.get('phone') || '').slice(0, 30),
      phoneCountry: String(formData.get('phoneCountry') || '').slice(0, 2),
      name: String(formData.get('name') || '').slice(0, 80),
    },
    attempt: Date.now(),
    ...extra,
  };
}

export async function startWhatsAppSignInAction(_prevState, formData) {
  const next = safeSignInNext(formData.get('next'));
  const entry = String(formData.get('entry') || 'whatsapp');
  const phone = phoneFromForm(formData);
  if (!phone) return refuse('phone', formData);

  const key = clientKey({ headers: await headers() });
  if (rateLimited(`wa-signin:${key}`, STARTS_PER_10_MIN)) return refuse('busy', formData);

  let customer = await getCustomerByPhone(phone);
  let created = false;
  if (!customer) {
    // A number we do not know: the same screen asks for the name, once.
    const fullName = cleanFullName(formData.get('name'));
    if (!fullName) return refuse(formData.get('name') ? 'name' : null, formData, { needName: true });
    try {
      customer = await createCustomer({ phone, passwordHash: null, fullName });
      created = true;
    } catch (err) {
      // A double tap racing itself: the account now exists, use it.
      if (err?.code !== '23505') throw err;
      customer = await getCustomerByPhone(phone);
      if (!customer) throw err;
    }
    await recordWebSignupAttribution({ accountType: 'customer', accountId: Number(customer.id), phone, typedCode: null });
    await recordSignupOutcome({ step: 'created', entry, customerId: Number(customer.id) });
    console.log(`[wa-signin] customer #${customer.id} created, waiting for the WhatsApp proof`);
  }

  await setVerifyAttemptCookie({ role: 'customer', id: Number(customer.id), phone });
  const query = new URLSearchParams({ next });
  if (created) query.set('nouveau', '1');
  redirect(`/compte/connexion/whatsapp?${query.toString()}`);
}

/**
 * Polled by the code screen. Which account comes from the signed attempt
 * cookie; whether it is proven, from the engine having matched the code on
 * that account's number. The browser's saved homes and searches ride along
 * and are merged into the account, as the password login does.
 *
 * @returns {Promise<{status: 'pending'|'expired'|'verified', href?: string}>}
 */
export async function checkWhatsAppSignInAction(nextParam, localData = {}) {
  const attempt = await getVerifyAttempt();
  if (!attempt || attempt.role !== 'customer') return { status: 'expired' };
  if (!(await consumeVerifiedChallenge(attempt))) return { status: 'pending' };

  const customer = await getCustomerAuthById(attempt.id);
  if (!customer) {
    await clearVerifyAttemptCookie();
    return { status: 'expired' };
  }
  if (!customer.phone_verified_at) await consumeCustomerOtp(attempt.id);
  await clearFailedLoginsAndTouchLogin(attempt.id);
  await clearVerifyAttemptCookie();
  await establishCustomerSession({ id: attempt.id, tokenVersion: customer.token_version });
  await rememberCustomerPhone(attempt.phone);

  const favoriteIds = Array.isArray(localData?.favoriteIds) ? localData.favoriteIds.map(String).filter(Boolean).slice(0, 200) : [];
  const savedSearches = Array.isArray(localData?.savedSearches) ? localData.savedSearches.slice(0, 20) : [];
  if (favoriteIds.length || savedSearches.length) {
    try {
      await mergeAnonymousData(attempt.id, { favoriteIds, savedSearches });
    } catch (err) {
      console.error(`[wa-signin] merging this device's saved homes into #${attempt.id} failed: ${err.message}`);
    }
  }

  if (isNewAccount(customer.created_at)) {
    // A new account proven by its own number is the ad platforms' CompleteRegistration.
    await recordAdEventFromAction({ name: 'CompleteRegistration', eventId: `reg-c-${attempt.id}`, phone: customer.phone || null });
  }
  console.log(`[wa-signin] customer #${attempt.id} signed in with WhatsApp`);
  return { status: 'verified', href: safeSignInNext(nextParam) };
}
