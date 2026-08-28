'use server';

import { redirect } from 'next/navigation';
import { normalizeCongoPhone } from '@/lib/phone';
import { requestPasswordReset } from '@/lib/resetPassword';
import { setResetAttemptCookie } from '@/lib/resetAttempt';

function safeRole(roleParam) {
  return roleParam === 'agent' ? 'agent' : 'customer';
}

/**
 * Step 1: request a code. Always redirects to step 2 on a valid phone —
 * whether or not that phone is actually registered under `role` — so an
 * attacker probing phone numbers can't tell the two cases apart from the
 * redirect alone (see resetPassword.js's requestPasswordReset doc comment).
 * A genuine delivery failure (`send_failed`) is the one thing worth
 * surfacing before step 2, since there is no code in flight to wait for.
 */
export async function requestResetAction(formData) {
  const role = safeRole(formData.get('role'));
  const phoneInput = String(formData.get('phone') || '');
  const phone = normalizeCongoPhone(phoneInput);

  if (!phone) {
    redirect(`/mot-de-passe-oublie?error=phone&role=${role}`);
  }

  const result = await requestPasswordReset(phoneInput, role);

  if (!result.ok) {
    redirect(`/mot-de-passe-oublie?error=${result.error}&role=${role}`);
  }

  await setResetAttemptCookie({ role, phone });
  redirect('/mot-de-passe-oublie/verifier');
}
