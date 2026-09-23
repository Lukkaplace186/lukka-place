'use server';

import { getPool } from '@/lib/db';
import { consumeAgentOtp } from '@/lib/agents';
import { consumeCustomerOtp, getCustomerAuthById } from '@/lib/customers';
import { establishAgentSession } from '@/lib/agentSession';
import { establishCustomerSession } from '@/lib/customerSession';
import { getVerifyAttempt, clearVerifyAttemptCookie } from '@/lib/verifyAttempt';
import { consumeVerifiedChallenge } from '@/lib/whatsappVerify';

function safeNext(nextParam, fallback) {
  const next = String(nextParam || '');
  return next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

/**
 * Polled by WhatsAppVerifyPanel. Which account is verified comes from the
 * signed attempt cookie, never from the caller; whether it is proven comes
 * from the engine having matched the code on the SENDER's number.
 *
 * @returns {Promise<{status: 'pending'|'expired'|'verified', href?: string}>}
 */
export async function checkWhatsAppVerificationAction(nextParam) {
  const attempt = await getVerifyAttempt();
  if (!attempt) return { status: 'expired' };

  if (!(await consumeVerifiedChallenge(attempt))) return { status: 'pending' };

  if (attempt.role === 'agent') {
    await consumeAgentOtp(attempt.id);
    const { rows } = await getPool().query('SELECT token_version FROM agents WHERE id = $1', [attempt.id]);
    await clearVerifyAttemptCookie();
    await establishAgentSession({ id: attempt.id, tokenVersion: rows[0]?.token_version });
    const explicit = safeNext(nextParam, '');
    return { status: 'verified', href: explicit && explicit !== '/compte/agent' ? explicit : '/compte/agent/parametres?bienvenue=1' };
  }

  await consumeCustomerOtp(attempt.id);
  const customer = await getCustomerAuthById(attempt.id);
  await clearVerifyAttemptCookie();
  await establishCustomerSession({ id: attempt.id, tokenVersion: customer?.token_version });
  return { status: 'verified', href: safeNext(nextParam, '/compte/client') };
}
