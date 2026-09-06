'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import {
  getCustomerByPhone,
  clearFailedLoginsAndTouchLogin,
  recordFailedLogin,
  mergeAnonymousData,
  sendCustomerOtp,
} from '@/lib/customers';
import {
  verifyPasswordAgainstHash,
  burnConstantTime,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_MS,
} from '@/lib/customerAuth';
import { establishCustomerSession } from '@/lib/customerSession';
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
 * Plain Server Action, matching the admin login's convention (errors via a
 * redirect + ?error= query param, not client state). The phone-not-found
 * and wrong-password paths both call a real scrypt comparison before
 * rejecting (burnConstantTime / verifyPasswordAgainstHash) so they cost the
 * same time and don't leak which case happened via response timing.
 */
export async function loginAction(formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const phone = phoneFromForm(formData);

  if (!phone) {
    redirect(`/compte/connexion?error=phone&next=${encodeURIComponent(next)}`);
  }

  const customer = await getCustomerByPhone(phone);

  if (!customer) {
    burnConstantTime(password);
    redirect(`/compte/connexion?error=1&next=${encodeURIComponent(next)}`);
  }

  if (customer.locked_until && new Date(customer.locked_until) > new Date()) {
    redirect(`/compte/connexion?error=locked&next=${encodeURIComponent(next)}`);
  }

  if (!verifyPasswordAgainstHash(password, customer.password_hash)) {
    const failedCount = customer.failed_login_count + 1;
    const shouldLock = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS;
    await recordFailedLogin(customer.id, { lockUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null });
    redirect(`/compte/connexion?error=${shouldLock ? 'locked' : '1'}&next=${encodeURIComponent(next)}`);
  }

  await clearFailedLoginsAndTouchLogin(customer.id);

  const { favoriteIds, savedSearches } = parseAnonymousData(formData);
  if (favoriteIds.length > 0 || savedSearches.length > 0) {
    await mergeAnonymousData(customer.id, { favoriteIds, savedSearches });
  }

  // An unverified number never gets a session — it gets a code. Two kinds
  // of account land here: one created since signup verification existed
  // whose owner closed the tab before entering the code, and one created
  // before it existed at all (scripts/migrate-customer-phone-verification.js
  // deliberately backfills nobody, because nobody proved those numbers).
  // Both are the same one-time step, and it is the same step an agent with
  // an unverified account already goes through.
  if (!customer.phone_verified_at) {
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

  await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });

  redirect(next);
}
