'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import { getCustomerByPhone, createCustomer, mergeAnonymousData, sendCustomerOtp } from '@/lib/customers';
import { hashPassword } from '@/lib/customerAuth';
import { setVerifyAttemptCookie } from '@/lib/verifyAttempt';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/client');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/client';
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
 * Creates the account, then hands off to the WhatsApp OTP step — it does
 * NOT establish a session. Nothing on this platform reaches a customer
 * except through their phone number (favourites alerts, viewing
 * confirmations, an agent calling back), so an account whose number was
 * mistyped is an account that silently never hears from us again. The code
 * is the only thing that proves the number was typed correctly and belongs
 * to whoever typed it.
 *
 * Same two-step shape agent signup has used since it was built; customer
 * signup is the side that was missing it.
 */
export async function signupAction(formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = phoneFromForm(formData);

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

  const customer = await createCustomer({ phone, passwordHash: hashPassword(password), fullName });

  // Merged now, before verification, deliberately: the row exists, the data
  // is the visitor's own device state, and losing it because a code was
  // slow to arrive would be a worse outcome than attaching it to an account
  // that is one WhatsApp code away from being usable.
  const { favoriteIds, savedSearches } = parseAnonymousData(formData);
  if (favoriteIds.length > 0 || savedSearches.length > 0) {
    await mergeAnonymousData(customer.id, { favoriteIds, savedSearches });
  }

  // Which account is being verified travels in a signed httpOnly cookie,
  // not the URL — see lib/verifyAttempt.js. Set before the send so that a
  // delivery failure still lands on a page that can offer a real resend.
  await setVerifyAttemptCookie({ role: 'customer', id: customer.id, phone });

  const verifyUrl = `/compte/inscription/verifier?next=${encodeURIComponent(next)}`;

  try {
    await sendCustomerOtp(customer.id, phone);
  } catch (err) {
    console.error(`[customer-auth] OTP send failed for customer #${customer.id}: ${err.message}`);
    redirect(`${verifyUrl}&error=send_failed`);
  }

  redirect(verifyUrl);
}
