import 'server-only';
import { sendCustomerOtp } from './customers';
import { canSendCode, noteCodeSent } from './signInCodeLimits';

/**
 * Signing in to an EXISTING customer account by a code we send to its
 * WhatsApp, typed on the site (owner, 2026-11-24: "asking them to message us
 * is not efficient"). A new number does not come here — it is signed in at
 * once (lib/newCustomerSession.js).
 *
 * The code goes out as the approved authentication template
 * (`AGENT_OTP_TEMPLATE`, lib/otpDelivery.js), which reaches a number that
 * never wrote to us. Chakra confirms nothing was delivered, so the code
 * screen keeps "send us the code from WhatsApp" underneath as the way out.
 */

/**
 * Is the sent code on? Needs a configured template (a session message never
 * reaches a cold number); `CUSTOMER_SENT_CODE=off` turns it off and the code
 * screen falls back to the person sending us a code. Read at call time.
 */
export function signInCodeEnabled() {
  const template = String(process.env.AGENT_OTP_TEMPLATE || '').trim();
  return Boolean(template) && process.env.CUSTOMER_SENT_CODE !== 'off';
}

/**
 * Sends a new code to the account's number (and replaces any earlier one).
 * Never throws.
 *
 * @param {{id: number|string, phone: string}} customer
 * @returns {Promise<'sent'|'busy'|'failed'|'off'>}
 */
export async function sendSignInCode(customer) {
  if (!signInCodeEnabled()) return 'off';
  const id = Number(customer.id);
  if (!canSendCode(id)) return 'busy';
  try {
    await sendCustomerOtp(id, customer.phone);
    noteCodeSent(id);
    console.log(`[signin-code] code sent to customer #${id}`);
    return 'sent';
  } catch (err) {
    console.error(`[signin-code] code for customer #${id} could not be sent: ${err.message}`);
    return 'failed';
  }
}
