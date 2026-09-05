'use server';

import { redirect } from 'next/navigation';
import { normalizePhone } from '@/lib/phone';
import { hashPassword } from '@/lib/agentAuth';
import { establishAgentSession } from '@/lib/agentSession';
import { consumeAgentActivationToken } from '@/lib/agents';

/**
 * Redeems the single-use activation token the WhatsApp intake bot sent
 * (services/agentOnboarding.js, engine repo) and sets the agent's first
 * password.
 *
 * There is deliberately NO OTP step here. The account this token belongs to
 * was created because the holder of that phone number sent us a WhatsApp
 * message from it — `phone_verified_at` is already set, by strictly stronger
 * evidence than an SMS code would provide. Re-verifying the number would be
 * asking them to prove something we already watched them prove, and every
 * SMS delivery failure in between is a real agent who never gets an account.
 * The token here protects the password, not the phone.
 *
 * Redirect-based (not a {ok, error} result) to match every other auth action
 * in this app — a failure re-renders the same page with a real error code in
 * the query string, keeping the token in the URL so a retry works.
 */
export async function activateAgentAction(formData) {
  const phone = normalizePhone(String(formData.get('phone') || ''));
  const token = String(formData.get('token') || '');
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('password_confirm') || '');

  const back = `/compte/agent/activer?phone=${encodeURIComponent(phone)}&token=${encodeURIComponent(token)}`;

  if (!phone || !token) redirect(`${back}&error=invalid`);
  if (password.length < 8) redirect(`${back}&error=password`);
  if (password !== confirm) redirect(`${back}&error=mismatch`);

  const agent = await consumeAgentActivationToken({
    phone,
    token,
    passwordHash: hashPassword(password),
  });
  if (!agent) redirect(`${back}&error=invalid`);

  await establishAgentSession({ id: agent.id, tokenVersion: agent.token_version });
  redirect('/compte/agent');
}
