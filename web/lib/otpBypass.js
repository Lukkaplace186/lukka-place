import 'server-only';

/**
 * **`AUTH_OTP_BYPASS=1`: send no code, prove the number by WhatsApp instead.**
 *
 * The `agent_auth_otp` template is not delivering (`(#132001) Template name
 * does not exist in the translation`), and a session message only reaches
 * someone who messaged the business number in the last 24 hours — never a
 * first-time registrant. So a SENT code cannot work yet.
 *
 * With the flag on, signup and login of an unverified account send nothing
 * and go straight to the verify page, which shows a code for the person to
 * send FROM their own WhatsApp (lib/whatsappVerify.js; the engine matches it
 * on the sender's number). Only then is the account phone-verified, via the
 * same consumeAgentOtp / consumeCustomerOtp a typed code uses.
 *
 * **History.** Until 2026-09-23 this flag skipped proof entirely: the account
 * was stamped verified at submit time, so anyone could register an agency's
 * number and — because consumeAgentOtp claims every listing ever sent from it
 * — take over its portfolio. Accounts created in that window are already
 * verified and were not re-checked.
 *
 * Read at call time, so `pm2 restart --update-env` is enough to change it.
 */
export function otpBypassEnabled() {
  return process.env.AUTH_OTP_BYPASS === '1';
}

/**
 * One log line per bypassed verification, so the server log says exactly how
 * many accounts were created without a verified number while this was on.
 * Silence here would make the window impossible to audit afterwards.
 */
export function logOtpBypass(label, { id, phone }) {
  console.warn(`[${label}] AUTH_OTP_BYPASS=1 — no code sent for #${id} (${phone}); proving the number via WhatsApp instead`);
}
