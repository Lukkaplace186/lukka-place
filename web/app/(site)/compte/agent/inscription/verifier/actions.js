'use server';

import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { consumeAgentOtp, sendAgentOtp } from '@/lib/agents';
import { verifyOtp } from '@/lib/agentAuth';
import { establishAgentSession } from '@/lib/agentSession';
import { getVerifyAttempt, setVerifyAttemptCookie, clearVerifyAttemptCookie } from '@/lib/verifyAttempt';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/agent');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/agent';
}

function backTo(next, params = '') {
  return `/compte/agent/inscription/verifier?next=${encodeURIComponent(next)}${params}`;
}

/**
 * Which account is being verified comes from the signed attempt cookie
 * (lib/verifyAttempt.js), not from a `?agent=<id>` param the visitor
 * controls. The row is still read fresh — the cookie says who, the database
 * says what their real code is.
 */
export async function agentVerifyOtpAction(formData) {
  const next = safeNext(formData.get('next'));
  const attempt = await getVerifyAttempt();

  if (!attempt || attempt.role !== 'agent') {
    redirect('/compte/agent/inscription');
  }

  const code = String(formData.get('code') || '').trim();

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, token_version, otp_code_hash, otp_expires_at FROM agents WHERE id = $1`,
    [attempt.id],
  );
  const agent = rows[0];

  if (!agent || !agent.otp_code_hash) {
    redirect(backTo(next, '&error=1'));
  }

  const expired = !agent.otp_expires_at || new Date(agent.otp_expires_at) <= new Date();
  const valid = !expired && verifyOtp(code, agent.otp_code_hash);

  if (!valid) {
    redirect(backTo(next, `&error=${expired ? 'expired' : '1'}`));
  }

  await consumeAgentOtp(agent.id);
  await clearVerifyAttemptCookie();
  await establishAgentSession({ id: agent.id, tokenVersion: agent.token_version });

  // A freshly verified agent goes to Paramètres, not the empty dashboard:
  // at this point they have a name and a verified number and nothing else,
  // and Paramètres is where the presentation, and the rest of the
  // profile-completion checklist, actually get filled in. An explicit
  // ?next= (e.g. a deep link they were bounced from) still wins.
  const explicitNext = String(formData.get('next') || '');
  redirect(explicitNext && explicitNext !== '/compte/agent' ? next : '/compte/agent/parametres?bienvenue=1');
}

export async function agentResendOtpAction(formData) {
  const next = safeNext(formData.get('next'));
  const attempt = await getVerifyAttempt();

  if (!attempt || attempt.role !== 'agent') {
    redirect('/compte/agent/inscription');
  }

  const pool = getPool();
  const { rows } = await pool.query('SELECT id, phone FROM agents WHERE id = $1', [attempt.id]);
  const agent = rows[0];
  if (!agent) redirect('/compte/agent/inscription');

  try {
    await sendAgentOtp(agent.id, agent.phone);
  } catch (err) {
    // Surfaced rather than swallowed — this used to redirect with `sent=1`
    // regardless, which told someone a code was on its way when the send
    // had just failed (web/CLAUDE.md, "Honest UI State").
    console.error(`[agent-auth] OTP resend failed for agent #${agent.id}: ${err.message}`);
    redirect(backTo(next, '&error=send_failed'));
  }

  // Refresh the window so a slow resend doesn't strand the attempt.
  await setVerifyAttemptCookie(attempt);
  redirect(backTo(next, '&sent=1'));
}
