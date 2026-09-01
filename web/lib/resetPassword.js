import 'server-only';
import { normalizePhone } from './phone';
import { generateOtpCode, hashToStoredForm, verifyAgainstStoredForm } from './authCrypto';
import { sendWhatsAppMessage } from './adminApi';
import { getCustomerByPhone, setCustomerResetOtp, resetCustomerPassword } from './customers';
import { getAgentByPhone, setAgentResetOtp, resetAgentPassword } from './agents';
import { hashPassword as hashCustomerPassword } from './customerAuth';
import { hashPassword as hashAgentPassword } from './agentAuth';

/**
 * Unified "Mot de passe oublié" for both account types
 * (web/app/(site)/mot-de-passe-oublie), driven by one role adapter so the
 * two Server Actions below never need an if/else on role — see
 * web/lib/customers.js's setCustomerResetOtp/resetCustomerPassword and
 * web/lib/agents.js's setAgentResetOtp/resetAgentPassword, which share this
 * exact shape on purpose.
 */
const ROLE_ADAPTERS = {
  customer: {
    getByPhone: getCustomerByPhone,
    setResetOtp: setCustomerResetOtp,
    resetPassword: resetCustomerPassword,
    hashPassword: hashCustomerPassword,
  },
  agent: {
    getByPhone: getAgentByPhone,
    setResetOtp: setAgentResetOtp,
    resetPassword: resetAgentPassword,
    hashPassword: hashAgentPassword,
  },
};

function adapterFor(role) {
  const adapter = ROLE_ADAPTERS[role];
  if (!adapter) throw new Error(`resetPassword: unknown role '${role}'`);
  return adapter;
}

// Burns roughly the real cost of a bad-OTP check for a phone/role that
// doesn't exist at all — same no-timing-signal-on-account-existence
// reasoning as customerAuth.js/agentAuth.js's own burnConstantTime.
const DUMMY_OTP_HASH = hashToStoredForm('lukka-reset-otp-dummy-comparison-value');

const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8; // matches signup's own "no policy engine" posture (see compte/inscription/actions.js)

/**
 * Step 1. Never reveals whether `phone` is actually registered under
 * `role` — a not-found account returns the exact same `{ ok: true }` a real
 * one does, so the request step can't be used to probe which phone numbers
 * have accounts. What it *can* honestly report is a genuine delivery
 * failure for a real account (`error: 'send_failed'`): most often WhatsApp's
 * 24h session window (see services/chakra.js in the engine repo) — Meta
 * rejects a free-form message to a number that hasn't messaged this
 * business number recently, and there is no Meta-approved template to fall
 * back to yet (see web/app/(site)/compte/page.js's identical note on why
 * self-service reset wasn't built before now). Silently claiming success
 * there would leave someone waiting forever for a code that's never
 * arriving — worse than the small account-existence signal this leaks, and
 * exactly what web/CLAUDE.md's "Honest UI State" rule argues against. The
 * caller routes this straight to the WhatsApp-support fallback CTA.
 *
 * @param {string} phoneInput
 * @param {'customer'|'agent'} role
 * @returns {Promise<{ok: true}|{ok: false, error: 'phone'|'send_failed'}>}
 */
export async function requestPasswordReset(phoneInput, role) {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false, error: 'phone' };

  const { getByPhone, setResetOtp } = adapterFor(role);
  const account = await getByPhone(phone);

  if (!account) {
    return { ok: true };
  }

  const code = generateOtpCode();
  await setResetOtp(account.id, {
    codeHash: hashToStoredForm(code),
    expiresAt: new Date(Date.now() + RESET_OTP_TTL_MS),
  });

  try {
    await sendWhatsAppMessage(
      phone,
      `Votre code de réinitialisation Lukka Place : ${code} (valable 10 minutes). Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    );
  } catch (err) {
    console.error(`[reset-password] OTP send failed for ${role} ${phone}: ${err.message}`);
    return { ok: false, error: 'send_failed' };
  }

  return { ok: true };
}

/**
 * Step 2. Validates the OTP (hash + expiry), then writes the new password,
 * clears the OTP, bumps token_version (every outstanding session on that
 * account — including the one that's now "logged in" on some other device
 * with the old password — dies), and clears any login lockout.
 *
 * @param {string} phoneInput
 * @param {string} otpCode
 * @param {string} newPassword
 * @param {'customer'|'agent'} role
 * @returns {Promise<{ok: true}|{ok: false, error: 'phone'|'weak_password'|'expired'|'invalid'}>}
 */
export async function verifyAndResetPassword(phoneInput, otpCode, newPassword, role) {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false, error: 'phone' };
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: 'weak_password' };
  }

  const { getByPhone, resetPassword, hashPassword } = adapterFor(role);
  const account = await getByPhone(phone);

  if (!account || !account.reset_otp_code_hash) {
    verifyAgainstStoredForm(String(otpCode || ''), DUMMY_OTP_HASH);
    return { ok: false, error: 'invalid' };
  }

  const expired = !account.reset_otp_expires_at || new Date(account.reset_otp_expires_at) <= new Date();
  const valid = !expired && verifyAgainstStoredForm(String(otpCode || ''), account.reset_otp_code_hash);

  if (!valid) {
    return { ok: false, error: expired ? 'expired' : 'invalid' };
  }

  await resetPassword(account.id, hashPassword(newPassword));
  return { ok: true };
}
