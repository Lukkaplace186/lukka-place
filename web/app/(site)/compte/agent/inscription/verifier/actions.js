'use server';

import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { consumeAgentOtp, sendAgentOtp } from '@/lib/agents';
import { verifyOtp } from '@/lib/agentAuth';
import { establishAgentSession } from '@/lib/agentSession';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/agent');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/agent';
}

/**
 * The agent id rides in a plain (non-secret) query param/hidden field —
 * it's not the credential, the OTP code is. Reads the row fresh rather
 * than trusting anything client-supplied beyond "which row to check."
 */
export async function agentVerifyOtpAction(formData) {
  const next = safeNext(formData.get('next'));
  const agentId = Number.parseInt(formData.get('agent'), 10);
  const code = String(formData.get('code') || '').trim();

  if (!Number.isFinite(agentId)) {
    redirect('/compte/agent/inscription');
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, token_version, otp_code_hash, otp_expires_at FROM agents WHERE id = $1`,
    [agentId],
  );
  const agent = rows[0];

  if (!agent || !agent.otp_code_hash) {
    redirect(`/compte/agent/inscription/verifier?agent=${agentId}&next=${encodeURIComponent(next)}&error=1`);
  }

  const expired = !agent.otp_expires_at || new Date(agent.otp_expires_at) <= new Date();
  const valid = !expired && verifyOtp(code, agent.otp_code_hash);

  if (!valid) {
    redirect(
      `/compte/agent/inscription/verifier?agent=${agentId}&next=${encodeURIComponent(next)}&error=${expired ? 'expired' : '1'}`,
    );
  }

  await consumeAgentOtp(agentId);
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
  const agentId = Number.parseInt(formData.get('agent'), 10);
  if (!Number.isFinite(agentId)) redirect('/compte/agent/inscription');

  const pool = getPool();
  const { rows } = await pool.query('SELECT id, phone FROM agents WHERE id = $1', [agentId]);
  const agent = rows[0];
  if (!agent) redirect('/compte/agent/inscription');

  try {
    await sendAgentOtp(agent.id, agent.phone);
  } catch (err) {
    console.error(`[agent-auth] OTP resend failed for agent #${agentId}: ${err.message}`);
  }
  redirect(`/compte/agent/inscription/verifier?agent=${agentId}&next=${encodeURIComponent(next)}&sent=1`);
}
