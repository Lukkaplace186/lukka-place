'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { phoneFromForm } from '@/lib/phone';
import { normaliseReferralCode } from '@/lib/launchCommission';
import { attributeNewAgent, checkReferralForSignup, recordReferralRefusal } from '@/lib/salesLaunch';
import { REFERRAL_COOKIE, clientIpFrom, hashReferralIp, parseReferralCookie } from '@/lib/salesReferral';
import { getAgentByPhone, createAgent, sendAgentOtp, reclaimUnverifiedAgent } from '@/lib/agents';
import { startAgentPasswordSetup } from '@/lib/agentPasswordSetup';
import { updateAgentIdentity } from '@/lib/agencies';
import { hashPassword } from '@/lib/agentAuth';
import { establishAgentSession } from '@/lib/agentSession';
import { setVerifyAttemptCookie } from '@/lib/verifyAttempt';
import { otpBypassEnabled, logOtpBypass } from '@/lib/otpBypass';
import { recordWebSignupAttribution } from '@/lib/accountAcquisition';
import { findActivePartnerByCode } from '@/lib/partners';

/**
 * What the agent typed, sent back with a refusal so the form keeps it
 * (2026-11-08). Never the password; the form keeps that in its own state.
 */
function refuse(error, formData) {
  return {
    error,
    values: {
      phone: String(formData.get('phone') || '').slice(0, 30),
      phoneCountry: String(formData.get('phoneCountry') || '').slice(0, 2),
      referralCode: String(formData.get('referral_code') || '').slice(0, 20),
    },
    attempt: Date.now(),
  };
}

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
export async function agentSignupAction(_prevState, formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const phone = phoneFromForm(formData);
  // agency_name + contact_name since 2026-09-21. `full_name` is still read
  // from a page rendered before that deploy, and keeps its old meaning (one
  // name, stored as the person) rather than failing the signup.
  const legacyFullName = String(formData.get('full_name') || '').trim().slice(0, 240);
  const agencyName = String(formData.get('agency_name') || '').trim().slice(0, 160);
  const contactName = String(formData.get('contact_name') || '').trim().slice(0, 160) || legacyFullName;

  // The agency is optional since 2026-11-04: most Kinshasa brokers are
  // independent commissionnaires, and a form that opened on "Nom de l'agence"
  // told them the page was not for them (4,215 ad visitors, 2 reached the
  // code step). Left empty, the public name is the person's (AGENCY_NAME_EXPR
  // and agentPublicName fall back to agent_infos) — never a copy stored as an
  // agency that does not exist.
  if (!contactName) return refuse('name', formData);
  if (!phone) return refuse('phone', formData);
  if (password.length < 8) return refuse('password', formData);

  const typedReferral = String(formData.get('referral_code') || '').trim().slice(0, 40);

  // An account already on this number (2026-11-08, owner request — each of
  // these used to end on "Un compte existe déjà" with no way forward):
  //  - removed by the team (soft-deleted): a new account is created; the
  //    removed one stays removed, and the phone lookup prefers the live one;
  //  - joined on WhatsApp, no password: set one with a WhatsApp code;
  //  - never verified and holding no listing (a mistyped number, a sign-up
  //    left at the code step): this sign-up takes it over — the number still
  //    has to be verified below;
  //  - verified, with a password: "exists", with sign-in and reset offered.
  const found = await getAgentByPhone(phone);
  const existing = found && !found.deleted_at ? found : null;
  if (existing && !existing.password_hash && existing.phone_verified_at) {
    redirect(await startAgentPasswordSetup(phone));
  }
  // Taken over just before the account would be created (below), once the
  // referral code has been checked.
  const reclaimable = Boolean(existing && !existing.phone_verified_at);
  if (existing && !reclaimable) {
    if (typedReferral) {
      await recordReferralRefusal({ code: typedReferral, agentId: Number(existing.id) || null, channel: 'web', reason: 'existing_agent' });
    }
    return refuse('exists', formData);
  }

  // The optional referral code (lib/salesLaunch.js, launch commission policy).
  // An unknown code is sent back BEFORE the account exists, so the agent can
  // correct it or clear the field; a lookup that fails never blocks signup.
  // The same field also takes a PARTNER's code (a creator's, another agent's —
  // lib/partnerRules.js): one code namespace with the reps, so a code that is
  // a live partner's is credited as that partner's referral and never
  // checked against sales_reps.
  let partnerCode = null;
  if (typedReferral) {
    try {
      const partner = await findActivePartnerByCode(typedReferral);
      if (partner) partnerCode = partner.code;
    } catch (err) {
      console.error(`[agent-auth] partner code check failed: ${err.message}`);
    }
  }

  let referral = null;
  if (typedReferral && !partnerCode) {
    let check = null;
    try {
      check = await checkReferralForSignup({ code: typedReferral, phoneDigits: phone });
    } catch (err) {
      console.error(`[agent-auth] referral check failed, signing up without it: ${err.message}`);
    }
    if (check && !check.ok && check.reason !== 'self_referral') {
      await recordReferralRefusal({ repId: check.rep?.id ?? null, code: typedReferral, channel: 'web', reason: check.reason });
      return refuse('ref', formData);
    }
    referral = check;
  }

  let reclaimed = null;
  if (reclaimable) {
    // null when it no longer qualifies (a listing arrived, or it was verified
    // in the meantime): then it is an account like any other.
    reclaimed = await reclaimUnverifiedAgent(existing.id, hashPassword(password));
    if (!reclaimed) return refuse('exists', formData);
    console.log(`[agent-auth] sign-up took over unverified agent #${reclaimed.id} (${phone})`);
  }
  const agent = reclaimed || (await createAgent({ phone, passwordHash: hashPassword(password) }));

  // Store both names straight away. Without this the account is created with
  // `username` = the phone digits, and the public page renders a 12-digit
  // number where the agency name belongs until the agent finds the settings
  // form. The person goes on the per-language agent_infos row; the agency on
  // agents.agency_name, which is what the public heading shows first.
  const [firstName, ...rest] = contactName.split(/\s+/);
  try {
    await updateAgentIdentity(agent.id, { firstName, lastName: rest.join(' ') || null, agencyName: agencyName || undefined });
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

  // Where the account came from (lib/accountAcquisition.js). A partner's link
  // (a creator's, say) is credited here; a rep's code stays the rep's
  // attribution above and is only noted as the account's referral code.
  await recordWebSignupAttribution({
    accountType: 'agent',
    accountId: Number(agent.id),
    phone,
    repCode: referral?.ok ? normaliseReferralCode(typedReferral) : null,
    typedCode: partnerCode,
  });

  // Which account is being verified travels in a signed httpOnly cookie
  // rather than the `?agent=<id>` query param this flow used to key on —
  // see lib/verifyAttempt.js for what that param made possible.
  await setVerifyAttemptCookie({ role: 'agent', id: agent.id, phone });

  // AUTH_OTP_BYPASS=1: no code is SENT (no Meta template exists), but the
  // number is still proven — the verify page asks for a WhatsApp message
  // from it (lib/whatsappVerify.js). This used to establish a session and
  // run consumeAgentOtp right here, which let anyone register an agency's
  // number and claim every listing it had WhatsApped in.
  if (otpBypassEnabled()) {
    logOtpBypass('agent-auth', { id: agent.id, phone });
    redirect(`/compte/agent/inscription/verifier?next=${encodeURIComponent(next)}`);
  }

  // A failed send lands on the verify page too (2026-11-08): the account
  // already exists, so "réessayez" on the sign-up form could only answer
  // "Un compte existe déjà". The verify page has "resend" and the WhatsApp
  // proof.
  let sent = true;
  try {
    await sendAgentOtp(agent.id, phone);
  } catch (err) {
    console.error(`[agent-auth] OTP send failed for agent #${agent.id}: ${err.message}`);
    sent = false;
  }

  redirect(`/compte/agent/inscription/verifier?next=${encodeURIComponent(next)}${sent ? '' : '&error=send_failed'}`);
}
