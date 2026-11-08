import 'server-only';
import { requestPasswordReset } from './resetPassword';
import { setResetAttemptCookie } from './resetAttempt';

/**
 * An agent who joined on WhatsApp has an account but no password (2026-11-08,
 * owner request): on the web, sign-in answered "mot de passe incorrect" and
 * locked them out after 5 tries, and sign-up said "un compte existe déjà".
 * Their only way in was the WhatsApp activation link, which expires after
 * 72 hours.
 *
 * Now both pages send them straight to "choose your password": a code by
 * WhatsApp to that number (the password-reset flow — it proves the number,
 * so it is safe to set the first password with it), then the password. The
 * reset clears any lockout and signs them in.
 *
 * @returns {Promise<string>} where to send the agent next
 */
export async function startAgentPasswordSetup(phone) {
  const result = await requestPasswordReset(phone, 'agent');
  if (!result.ok) {
    console.error(`[agent-auth] first-password code not sent to ${phone}: ${result.error}`);
    return `/mot-de-passe-oublie?error=${result.error}&role=agent`;
  }
  await setResetAttemptCookie({ role: 'agent', phone });
  console.log(`[agent-auth] ${phone} has no password (joined on WhatsApp): first-password code sent`);
  return '/mot-de-passe-oublie/verifier?nouveau=1';
}
