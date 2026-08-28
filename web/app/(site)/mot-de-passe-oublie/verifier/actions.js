'use server';

import { redirect } from 'next/navigation';
import { verifyAndResetPassword, requestPasswordReset } from '@/lib/resetPassword';
import { getResetAttempt, setResetAttemptCookie, clearResetAttemptCookie } from '@/lib/resetAttempt';

const LOGIN_PATH_BY_ROLE = { customer: '/compte/connexion', agent: '/compte/agent/connexion' };

export async function verifyResetOtpAction(formData) {
  const attempt = await getResetAttempt();
  if (!attempt) {
    redirect('/mot-de-passe-oublie?error=expired_attempt');
  }

  const code = String(formData.get('code') || '').trim();
  const newPassword = String(formData.get('newPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (newPassword !== confirmPassword) {
    redirect('/mot-de-passe-oublie/verifier?error=mismatch');
  }

  const result = await verifyAndResetPassword(attempt.phone, code, newPassword, attempt.role);

  if (!result.ok) {
    redirect(`/mot-de-passe-oublie/verifier?error=${result.error}`);
  }

  await clearResetAttemptCookie();
  redirect(`${LOGIN_PATH_BY_ROLE[attempt.role]}?reset=1`);
}

/** "Code non reçu ? Réessayer via WhatsApp" — re-runs step 1 for the same phone/role already held in the attempt cookie, no form fields needed. */
export async function resendResetOtpAction() {
  const attempt = await getResetAttempt();
  if (!attempt) {
    redirect('/mot-de-passe-oublie?error=expired_attempt');
  }

  const result = await requestPasswordReset(attempt.phone, attempt.role);
  // Refresh the cookie's TTL too, so waiting a while before resending
  // doesn't bounce the visitor back to step 1 mid-flow.
  await setResetAttemptCookie(attempt);

  if (!result.ok) {
    redirect(`/mot-de-passe-oublie/verifier?error=${result.error}`);
  }
  redirect('/mot-de-passe-oublie/verifier?sent=1');
}
