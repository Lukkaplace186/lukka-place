'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { phoneFromForm } from '@/lib/phone';
import { normaliseReferralCode } from '@/lib/launchCommission';
import { attributeNewAgent, checkReferralForSignup, recordReferralRefusal } from '@/lib/salesLaunch';
import { REFERRAL_COOKIE, clientIpFrom, hashReferralIp, parseReferralCookie } from '@/lib/salesReferral';
import { getAgentByPhone, createAgent, sendAgentOtp, consumeAgentOtp } from '@/lib/agents';
import { updateAgentIdentity } from '@/lib/agencies';
import { hashPassword } from '@/lib/agentAuth';
import { establishAgentSession } from '@/lib/agentSession';
import { setVerifyAttemptCookie } from '@/lib/verifyAttempt';
import { otpBypassEnabled, logOtpBypass } from '@/lib/otpBypass';

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
  const phone = phoneFromForm(formData);
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

  const typedReferral = String(formData.get('referral_code') || '').trim().slice(0, 40);

  const existing = await getAgentByPhone(phone);
  if (existing) {
    if (typedReferral) {
      await recordReferralRefusal({ code: typedReferral, agentId: Number(existing.id) || null, channel: 'web', reason: 'existing_agent' });
    }
    redirect(`/compte/agent/inscription?error=exists&next=${encodeURIComponent(next)}`);
  }

  // The optional referral code (lib/salesLaunch.js, launch commission policy).
  // An unknown code is sent back BEFORE the account exists, so the agent can
  // correct it or clear the field; a lookup that fails never blocks signup.
  let referral = null;
  if (typedReferral) {
    let check = null;
    try {
      check = await checkReferralForSignup({ code: typedReferral, phoneDigits: phone });
    } catch (err) {
      console.error(`[agent-auth] referral check failed, signing up without it: ${err.message}`);
    }
    if (check && !check.ok && check.reason !== 'self_referral') {
      await recordReferralRefusal({ repId: check.rep?.id ?? null, code: typedReferral, channel: 'web', reason: check.reason });
      redirect(`/compte/agent/inscription?error=ref&next=${encodeURIComponent(next)}`);
    }
    referral = check;
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

  if (referral?.ok) {
    try {
      const cookieStore = await cookies();
      const remembered = parseReferralCookie(cookieStore.get(REFERRAL_COOKIE)?.value);
      const code = normaliseReferralCode(typedReferral);
      await attributeNewAgent({
        agentId: agent.id,
        repId: referral.rep.id,
        code,
        source: remembered?.code === code ? remembered.source : 'form_code',
        ipHash: hashReferralIp(clientIpFrom(await headers())),
      });
    } catch (err) {
      // The account is theirs either way; management can attribute it by override.
      console.error(`[agent-auth] referral attribution failed for agent #${agent.id}: ${err.message}`);
    }
  } else if (referral?.reason === 'self_referral') {
    await recordReferralRefusal({ repId: referral.rep?.id ?? null, code: typedReferral, agentId: Number(agent.id), channel: 'web', reason: 'self_referral' });
  }

  // Testing mode: no code, straight to a session. consumeAgentOtp is reused
  // rather than a second UPDATE, which also means the bypassed path still
  // runs the retroactive listing claim — the thing that makes an agent who
  // already WhatsApped listings find them on their dashboard.
  if (otpBypassEnabled()) {
    logOtpBypass('agent-auth', { id: agent.id, phone });
    await consumeAgentOtp(agent.id);
    await establishAgentSession({ id: agent.id, tokenVersion: agent.token_version });
    redirect(next);
  }

  // Which account is being verified travels in a signed httpOnly cookie
  // rather than the `?agent=<id>` query param this flow used to key on —
  // see lib/verifyAttempt.js for what that param made possible.
  await setVerifyAttemptCookie({ role: 'agent', id: agent.id, phone });

  try {
    await sendAgentOtp(agent.id, phone);
  } catch (err) {
    console.error(`[agent-auth] OTP send failed for agent #${agent.id}: ${err.message}`);
    redirect(`/compte/agent/inscription?error=otp_failed&next=${encodeURIComponent(next)}`);
  }

  redirect(`/compte/agent/inscription/verifier?next=${encodeURIComponent(next)}`);
}
