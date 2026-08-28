'use server';

import { redirect } from 'next/navigation';
import { normalizeCongoPhone } from '@/lib/phone';
import { getAgentByPhone, recordAgentFailedLogin, clearAgentFailedLogins, sendAgentOtp } from '@/lib/agents';
import { verifyPasswordAgainstHash, burnConstantTime, MAX_FAILED_LOGIN_ATTEMPTS, LOCKOUT_MS } from '@/lib/agentAuth';
import { establishAgentSession } from '@/lib/agentSession';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/agent');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/agent';
}

/** Same shape as web/app/(site)/compte/connexion/actions.js's loginAction. */
export async function agentLoginAction(formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const phone = normalizeCongoPhone(String(formData.get('phone') || ''));

  if (!phone) {
    redirect(`/compte/agent/connexion?error=phone&next=${encodeURIComponent(next)}`);
  }

  const agent = await getAgentByPhone(phone);

  if (!agent) {
    burnConstantTime(password);
    redirect(`/compte/agent/connexion?error=1&next=${encodeURIComponent(next)}`);
  }

  if (agent.locked_until && new Date(agent.locked_until) > new Date()) {
    redirect(`/compte/agent/connexion?error=locked&next=${encodeURIComponent(next)}`);
  }

  if (!verifyPasswordAgainstHash(password, agent.password_hash)) {
    const failedCount = agent.failed_login_count + 1;
    const shouldLock = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS;
    await recordAgentFailedLogin(agent.id, { lockUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null });
    redirect(`/compte/agent/connexion?error=${shouldLock ? 'locked' : '1'}&next=${encodeURIComponent(next)}`);
  }

  await clearAgentFailedLogins(agent.id);

  if (!agent.phone_verified_at) {
    try {
      await sendAgentOtp(agent.id, phone);
    } catch (err) {
      console.error(`[agent-auth] OTP send failed for agent #${agent.id}: ${err.message}`);
      redirect(`/compte/agent/connexion?error=otp_failed&next=${encodeURIComponent(next)}`);
    }
    redirect(`/compte/agent/inscription/verifier?agent=${agent.id}&next=${encodeURIComponent(next)}`);
  }

  await establishAgentSession({ id: agent.id, tokenVersion: agent.token_version });
  redirect(next);
}
