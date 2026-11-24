import 'server-only';
import { createCustomer, getCurrentCustomerId, getCustomerByPhone } from './customers';
import { setVerifyAttemptCookie } from './verifyAttempt';
import { recordWebSignupAttribution } from './accountAcquisition';
import { recordSignupOutcome } from './signupFunnel';
import { guestAccountPlan } from './guestAccountRules';

/**
 * Opens (or finds) the customer account of someone who just left a name and a
 * WhatsApp number on a form (lib/guestAccountRules.js has the why). No session
 * is opened here: a signed attempt cookie is set so the confirmation can send
 * them straight to the code screen, where a message FROM that number signs
 * them in (app/(site)/compte/connexion/whatsapp).
 *
 * - unknown number + a usable name → account created ('created'), counted in
 *   the sign-up funnel under `entry`;
 * - known number → nothing created ('existing'): the code screen signs them in;
 * - no usable name, a demo number, a signed-in customer or an unticked box →
 *   'skipped'.
 *
 * Runs after the form's own work succeeded and never throws into it: a lead
 * or a visit must never be lost because the account step failed.
 *
 * @returns {Promise<{status: 'created'|'existing'|'skipped', reason?: string, customerId: number|null}>}
 */
export async function openGuestAccount({ phone, name, entry, requested = true }) {
  try {
    const signedIn = Boolean(await getCurrentCustomerId());
    const plan = guestAccountPlan({ phone, name, requested, signedIn });
    if (plan.action === 'skip') return { status: 'skipped', reason: plan.reason, customerId: null };

    let customer = await getCustomerByPhone(phone);
    if (customer) {
      await setVerifyAttemptCookie({ role: 'customer', id: Number(customer.id), phone });
      return { status: 'existing', customerId: Number(customer.id) };
    }
    if (!plan.fullName) return { status: 'skipped', reason: 'no_name', customerId: null };

    try {
      customer = await createCustomer({ phone, passwordHash: null, fullName: plan.fullName });
    } catch (err) {
      // Two submits racing each other: the account now exists, use it.
      if (err?.code !== '23505') throw err;
      customer = await getCustomerByPhone(phone);
      if (!customer) throw err;
      await setVerifyAttemptCookie({ role: 'customer', id: Number(customer.id), phone });
      return { status: 'existing', customerId: Number(customer.id) };
    }
    const id = Number(customer.id);
    await recordWebSignupAttribution({ accountType: 'customer', accountId: id, phone, typedCode: null });
    await recordSignupOutcome({ step: 'created', entry, customerId: id });
    await setVerifyAttemptCookie({ role: 'customer', id, phone });
    console.log(`[guest-account] customer #${id} created from ${entry}, waiting for the WhatsApp proof`);
    return { status: 'created', customerId: id };
  } catch (err) {
    console.error(`[guest-account] account step after ${entry} failed (the ${entry} itself went through): ${err.message}`);
    return { status: 'skipped', reason: 'error', customerId: null };
  }
}
