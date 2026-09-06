'use server';

import { redirect } from 'next/navigation';
import { getCustomerAuthById, consumeCustomerOtp, sendCustomerOtp } from '@/lib/customers';
import { verifyOtp } from '@/lib/authCrypto';
import { establishCustomerSession } from '@/lib/customerSession';
import { getVerifyAttempt, setVerifyAttemptCookie, clearVerifyAttemptCookie } from '@/lib/verifyAttempt';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte/client');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte/client';
}

function backTo(next, params = '') {
  return `/compte/inscription/verifier?next=${encodeURIComponent(next)}${params}`;
}

/**
 * Which account is being verified comes from the signed attempt cookie, not
 * from the form — see lib/verifyAttempt.js. The only thing the visitor
 * supplies here is the code itself, and the session is established only
 * after a real code matches an unexpired hash.
 */
export async function customerVerifyOtpAction(formData) {
  const next = safeNext(formData.get('next'));
  const attempt = await getVerifyAttempt();

  if (!attempt || attempt.role !== 'customer') {
    redirect('/compte/inscription?error=expired_attempt');
  }

  const customer = await getCustomerAuthById(attempt.id);

  if (!customer || !customer.otp_code_hash) {
    redirect(backTo(next, '&error=1'));
  }

  const expired = !customer.otp_expires_at || new Date(customer.otp_expires_at) <= new Date();
  const valid = !expired && verifyOtp(String(formData.get('code') || '').trim(), customer.otp_code_hash);

  if (!valid) {
    redirect(backTo(next, `&error=${expired ? 'expired' : '1'}`));
  }

  await consumeCustomerOtp(customer.id);
  await clearVerifyAttemptCookie();
  await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });

  redirect(next);
}

export async function customerResendOtpAction(formData) {
  const next = safeNext(formData.get('next'));
  const attempt = await getVerifyAttempt();

  if (!attempt || attempt.role !== 'customer') {
    redirect('/compte/inscription?error=expired_attempt');
  }

  const customer = await getCustomerAuthById(attempt.id);
  if (!customer) {
    redirect('/compte/inscription?error=expired_attempt');
  }

  try {
    await sendCustomerOtp(customer.id, customer.phone);
  } catch (err) {
    // Reported, not swallowed: someone waiting on a code that cannot be
    // delivered needs to see the WhatsApp-support fallback, not a silent
    // "sent" that never arrives (web/CLAUDE.md, "Honest UI State").
    console.error(`[customer-auth] OTP resend failed for customer #${customer.id}: ${err.message}`);
    redirect(backTo(next, '&error=send_failed'));
  }

  // Refresh the window too, so waiting a while before resending doesn't
  // bounce the visitor back to the start of signup mid-flow.
  await setVerifyAttemptCookie(attempt);
  redirect(backTo(next, '&sent=1'));
}
