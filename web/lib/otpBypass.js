import 'server-only';

/**
 * **Testing-mode switch: the WhatsApp OTP gate, off.**
 *
 * The `agent_auth_otp` template is not delivering (the same
 * `(#132001) Template name does not exist in the translation` state the
 * engine's CLAUDE.md already documents for AGENT_LEAD_MATCH_TEMPLATE), and
 * the session-message fallback in lib/otpDelivery.js only reaches somebody
 * who messaged the business number in the last 24 hours — which a first-time
 * registrant never has. So nobody can currently finish a signup, and the
 * whole point-A-to-point-B flow (register on the web, send a listing on
 * WhatsApp, see it on your dashboard) is untestable.
 *
 * With `AUTH_OTP_BYPASS=1` set, signup and login skip the code entirely:
 * the account is stamped phone-verified and given a session at submit time.
 * Passwords are still hashed the same way (scrypt via lib/authCrypto.js) and
 * sessions are still the same signed tokens — this changes ONE thing, whether
 * a code has to be presented, and nothing else.
 *
 * **What it costs, stated plainly.** Phone verification is the only thing
 * proving a registrant holds the number they typed. With this on, anyone can
 * register any number and be treated as its owner — and because
 * `consumeAgentOtp` claims every listing ever sent from that number
 * (lib/agents.js), an agent signup on somebody else's number hands over that
 * agency's portfolio. That is acceptable for a closed testing window on a
 * known set of numbers; it is not acceptable once real agents are being
 * onboarded. Unset the variable to restore the gate — no code change, no
 * revert, no redeploy of anything but the env.
 *
 * Read at call time, not at module load, so a test can toggle it and so the
 * running server picks it up from a `pm2 restart --update-env`.
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
  console.warn(`[${label}] AUTH_OTP_BYPASS=1 — phone verification skipped for #${id} (${phone})`);
}
