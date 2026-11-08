'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import {
  getAgentByPhone,
  recordAgentFailedLogin,
  clearAgentFailedLogins,
  sendAgentOtp,
  consumeAgentOtp,
} from '@/lib/agents';
import { verifyPasswordAgainstHash, burnConstantTime, MAX_FAILED_LOGIN_ATTEMPTS, LOCKOUT_MS } from '@/lib/agentAuth';
import { establishAgentSession, rememberAgentPhone } from '@/lib/agentSession';
import { setVerifyAttemptCookie } from '@/lib/verifyAttempt';
import { otpBypassEnabled, logOtpBypass } from '@/lib/otpBypass';
import { recordAgentLoginAttempt } from '@/lib/agentLoginLog';
import { consumeProofAtLogin } from '@/lib/whatsappVerify';
import { startAgentPasswordSetup } from '@/lib/agentPasswordSetup';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/agent');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/agent';
}

/**
 * A refusal comes back as state with what was typed (2026-11-08: a failed
 * sign-in used to empty the number field). The password is never sent back;
 * the form keeps it in its own state.
 */
function refuse(error, formData) {
  return {
    error,
    values: { phone: String(formData.get('phone') || '').slice(0, 30), phoneCountry: String(formData.get('phoneCountry') || '').slice(0, 2) },
    attempt: Date.now(),
  };
}

/**
 * Same shape as web/app/(site)/compte/connexion/actions.js's loginAction: a
 * useActionState action — a refusal RETURNS state, success redirects.
 */
export async function agentLoginAction(_prevState, formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const phone = phoneFromForm(formData);

  if (!phone) return refuse('phone', formData);

  const found = await getAgentByPhone(phone);
  // A soft-deleted account (lib/adminSoftDelete.js) answers like a wrong password.
  const agent = found && !found.deleted_at ? found : null;

  if (!agent) {
    burnConstantTime(password);
    return refuse('1', formData);
  }

  // Joined on WhatsApp, never chose a password (2026-11-08): no password can
  // ever match, so instead of "incorrect" and a lockout, a WhatsApp code to
  // that number and "choose your password" (lib/agentPasswordSetup.js).
  // (Not written to agent_login_attempts: its outcome CHECK has no value for it;
  // the server log line in startAgentPasswordSetup says it happened.)
  if (!agent.password_hash) {
    redirect(await startAgentPasswordSetup(phone));
  }

  if (agent.locked_until && new Date(agent.locked_until) > new Date()) {
    await recordAgentLoginAttempt(agent.id, 'locked');
    return refuse('locked', formData);
  }

  if (!verifyPasswordAgainstHash(password, agent.password_hash)) {
    const failedCount = agent.failed_login_count + 1;
    const shouldLock = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS;
    await recordAgentFailedLogin(agent.id, { lockUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null });
    await recordAgentLoginAttempt(agent.id, 'wrong_password');
    return refuse(shouldLock ? 'locked' : '1', formData);
  }

  await clearAgentFailedLogins(agent.id);
  await rememberAgentPhone(phone);
  // A number already proven by a WhatsApp message the verify page never
  // collected (lib/whatsappVerify.js consumeProofAtLogin): this login
  // finishes the verification — and the listing claim that goes with it —
  // instead of asking again.
  if (!agent.phone_verified_at && (await consumeProofAtLogin({ role: 'agent', id: agent.id, phone }))) {
    await consumeAgentOtp(agent.id);
    await recordAgentLoginAttempt(agent.id, 'whatsapp_verified');
    agent.phone_verified_at = new Date();
  }
  // Signed in now, or sent on to prove the number first (the console shows
  // the second as "vérification en attente").
  await recordAgentLoginAttempt(agent.id, agent.phone_verified_at ? 'success' : 'verify_required');

  if (!agent.phone_verified_at && otpBypassEnabled()) {
    // No code is sent, but the number is still proven: the verify page asks
    // for a WhatsApp message from it (lib/whatsappVerify.js). A matching
    // password proves the account, never the number.
    logOtpBypass('agent-auth', { id: agent.id, phone });
    await setVerifyAttemptCookie({ role: 'agent', id: agent.id, phone });
    redirect(`/compte/agent/inscription/verifier?next=${encodeURIComponent(next)}`);
  } else if (!agent.phone_verified_at) {
    await setVerifyAttemptCookie({ role: 'agent', id: agent.id, phone });
    let sent = true;
    try {
      await sendAgentOtp(agent.id, phone);
    } catch (err) {
      console.error(`[agent-auth] OTP send failed for agent #${agent.id}: ${err.message}`);
      sent = false;
    }
    // A failed send still lands on the verify page (2026-11-08): it has
    // "resend" and the WhatsApp proof, where sign-in had only "réessayez".
    redirect(`/compte/agent/inscription/verifier?next=${encodeURIComponent(next)}${sent ? '' : '&error=send_failed'}`);
  }

  await establishAgentSession({ id: agent.id, tokenVersion: agent.token_version });
  redirect(next);
}
