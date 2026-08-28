'use server';

import { redirect } from 'next/navigation';
import { normalizeCongoPhone } from '@/lib/phone';
import { getAgentByPhone, createAgent, sendAgentOtp } from '@/lib/agents';
import { updateAgentIdentity } from '@/lib/agencies';
import { hashPassword } from '@/lib/agentAuth';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/agent');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/agent';
}

/**
 * Creates the agents row immediately (status=1, vendor_id NULL — an admin
 * links the real agency afterward via Phase 2's reassignAgentVendorAction)
 * but the account isn't usable to log in until agentVerifyOtpAction
 * confirms real phone ownership — same two-step shape as every other real
 * phone-verified signup, matching this platform's own "phone is the primary
 * identifier" rule (see web/CLAUDE.md) more strictly than customer signup
 * does today (customers aren't phone-verified at all — agents publish
 * public contact info, which is why this extra step is worth it here).
 */
export async function agentSignupAction(formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const phone = normalizeCongoPhone(String(formData.get('phone') || ''));
  const fullName = String(formData.get('full_name') || '').trim().slice(0, 240);

  if (!fullName) {
    redirect(`/compte/agent/inscription?error=name&next=${encodeURIComponent(next)}`);
  }

  if (!phone) {
    redirect(`/compte/agent/inscription?error=phone&next=${encodeURIComponent(next)}`);
  }

  if (password.length < 8) {
    redirect(`/compte/agent/inscription?error=password&next=${encodeURIComponent(next)}`);
  }

  const existing = await getAgentByPhone(phone);
  if (existing) {
    redirect(`/compte/agent/inscription?error=exists&next=${encodeURIComponent(next)}`);
  }

  const agent = await createAgent({ phone, passwordHash: hashPassword(password) });

  // Store the name straight away, on the same per-language agent_infos row
  // the dashboard and public storefront both read. Without this the account
  // is created with `username` = the phone digits, and the public page then
  // renders a 12-digit number where the agency name belongs until the agent
  // happens to find the settings form.
  const [firstName, ...rest] = fullName.split(/\s+/);
  try {
    await updateAgentIdentity(agent.id, { firstName, lastName: rest.join(' ') || null });
  } catch (err) {
    // A name that fails to save must not cost the agent their account — the
    // row already exists and the name is editable later in Paramètres.
    console.error(`[agent-auth] could not store name for agent #${agent.id}: ${err.message}`);
  }

  try {
    await sendAgentOtp(agent.id, phone);
  } catch (err) {
    console.error(`[agent-auth] OTP send failed for agent #${agent.id}: ${err.message}`);
    redirect(`/compte/agent/inscription?error=otp_failed&next=${encodeURIComponent(next)}`);
  }

  redirect(`/compte/agent/inscription/verifier?agent=${agent.id}&next=${encodeURIComponent(next)}`);
}
