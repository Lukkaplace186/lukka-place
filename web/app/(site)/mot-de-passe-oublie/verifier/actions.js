'use server';

import { redirect } from 'next/navigation';
import { verifyAndResetPassword, requestPasswordReset } from '@/lib/resetPassword';
import { getResetAttempt, setResetAttemptCookie, clearResetAttemptCookie } from '@/lib/resetAttempt';
import { getCustomerByPhone } from '@/lib/customers';
import { establishCustomerSession, rememberCustomerPhone } from '@/lib/customerSession';
import { getAgentByPhone } from '@/lib/agents';
import { establishAgentSession, rememberAgentPhone } from '@/lib/agentSession';

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

  // A customer who just proved their WhatsApp with the code and chose a new
  // password is signed in straight away (2026-11-08): sending them to the
  // sign-in page to type both again was one step too many. The reset already
  // ended every other session (token_version + 1), so this reads the new one.
  if (attempt.role === 'customer') {
    const customer = await getCustomerByPhone(attempt.phone).catch(() => null);
    if (customer) {
      await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });
      await rememberCustomerPhone(attempt.phone);
      redirect('/compte/client?motdepasse=change');
    }
  }
  // An agent too (2026-11-08) — including one who joined on WhatsApp and just
  // chose a first password — when their number is already verified. One whose
  // number is not goes through sign-in, which sends them to verify it.
  if (attempt.role === 'agent') {
    const agent = await getAgentByPhone(attempt.phone).catch(() => null);
    if (agent && !agent.deleted_at && agent.phone_verified_at) {
      await establishAgentSession({ id: agent.id, tokenVersion: agent.token_version });
      await rememberAgentPhone(attempt.phone);
      redirect('/compte/agent?motdepasse=change');
    }
  }
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
