import 'server-only';
import { getAgentById, resetAgentPassword } from './agents';
import { adminGetCustomerById, resetCustomerPassword } from './customers';
import { hashPassword as hashAgentPassword } from './agentAuth';
import { hashPassword as hashCustomerPassword } from './customerAuth';

/**
 * "Set this account's password to X", for both realms, in one place.
 *
 * Why it exists at all: the self-service reset (`/mot-de-passe-oublie`) and
 * the WhatsApp activation link both depend on a WhatsApp message actually
 * arriving, and right now one does not (see lib/otpBypass.js). An admin who
 * can reach the console needs a way to put a locked-out agent or customer
 * back into their account without a message leaving the building.
 *
 * **It reuses resetAgentPassword / resetCustomerPassword rather than issuing
 * its own UPDATE.** Those two already carry the semantics a password change
 * has to have here — replace the hash, clear any in-flight reset code, bump
 * `token_version` so every outstanding session dies, and clear the login
 * lockout. An admin-set password that skipped the `token_version` bump would
 * leave whoever was already signed in on the old password still signed in,
 * which is exactly the case an admin reset is usually being used to end.
 *
 * The two realms keep their own hashers on purpose: `agentAuth` and
 * `customerAuth` are separate auth realms with separate session secrets
 * (tests/unit/auth-realms.test.js pins that), and collapsing them to one
 * import here would be the first crack in that separation. They happen to
 * compute the same scrypt form today; that is not a guarantee to build on.
 *
 * The plaintext is never stored, never logged, and never returned — the
 * admin typed it, so the admin is the one who relays it.
 */

/** Same floor the two signup forms enforce; no policy engine anywhere in this app. */
export const MIN_ADMIN_SET_PASSWORD_LENGTH = 8;

const REALMS = {
  agent: { find: getAgentById, write: resetAgentPassword, hash: hashAgentPassword },
  customer: { find: adminGetCustomerById, write: resetCustomerPassword, hash: hashCustomerPassword },
};

/**
 * @param {{role: 'agent'|'customer', id: number, password: string, confirm?: string}} input
 * @returns {Promise<{ok: true, phone: string|null} | {ok: false, errorKey: string}>}
 *   An `errorKey`, not a message: this module has no request context, so the
 *   calling Server Action resolves it in the admin's own language — the same
 *   split lib/agents.js's issueAgentActivationLink already uses.
 */
export async function adminSetAccountPassword({ role, id, password, confirm }) {
  const realm = REALMS[role];
  if (!realm) return { ok: false, errorKey: 'errors.actionFailed' };

  const accountId = Number.parseInt(id, 10);
  if (!Number.isFinite(accountId)) return { ok: false, errorKey: 'errors.actionFailed' };

  const value = String(password ?? '');
  if (value.length < MIN_ADMIN_SET_PASSWORD_LENGTH) return { ok: false, errorKey: 'admin.password.tooShort' };
  // Checked server-side as well as in the form: an admin who mistypes a
  // password they are about to read out over the phone locks the account
  // holder out more thoroughly than they were before.
  if (confirm !== undefined && value !== String(confirm)) return { ok: false, errorKey: 'admin.password.mismatch' };

  const account = await realm.find(accountId);
  if (!account) return { ok: false, errorKey: 'admin.password.accountNotFound' };

  await realm.write(accountId, realm.hash(value));

  return { ok: true, phone: account.phone || null };
}
