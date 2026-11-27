/**
 * Limits on the code we send to sign in to an existing customer account
 * (2026-11-24, lib/signInCode.js). A 6-digit code is the only thing between a
 * typed number and someone's account, so:
 *
 * - 5 wrong tries per code: the 5th wipes the code (a new one must be sent),
 *   so guessing is 5 in a million per code, not "as many as 10 minutes allow";
 * - 3 codes per account per 10 minutes: each send is a paid WhatsApp template
 *   and a message on someone's phone.
 *
 * In memory, per web process (there is one). A restart forgets the counts,
 * which costs at most one more round of tries; the code itself lives in
 * Postgres with its 10-minute expiry.
 */

export const TRIES_PER_CODE = 5;
export const SENDS_PER_WINDOW = 3;
export const SEND_WINDOW_MS = 10 * 60 * 1000;

const wrongTries = new Map(); // customerId -> wrong tries on the current code
const sends = new Map(); // customerId -> send timestamps (ms)

// A customer is its bare id; an agent passes `agent:<id>` (lib/agentCode.js).
function idKey(id) {
  return typeof id === 'string' && id.includes(':') ? id : String(Number(id));
}

/** May another code be sent to this account now? */
export function canSendCode(customerId, now = Date.now()) {
  const recent = (sends.get(idKey(customerId)) || []).filter((t) => now - t < SEND_WINDOW_MS);
  return recent.length < SENDS_PER_WINDOW;
}

/** A code was sent: counted, and the wrong tries start again for it. */
export function noteCodeSent(customerId, now = Date.now()) {
  const key = idKey(customerId);
  const recent = (sends.get(key) || []).filter((t) => now - t < SEND_WINDOW_MS);
  recent.push(now);
  sends.set(key, recent);
  wrongTries.delete(key);
}

/**
 * A wrong code was typed.
 * @returns {boolean} true when that was the last allowed try (wipe the code)
 */
export function noteWrongCode(customerId) {
  const key = idKey(customerId);
  const count = (wrongTries.get(key) || 0) + 1;
  if (count >= TRIES_PER_CODE) {
    wrongTries.delete(key);
    return true;
  }
  wrongTries.set(key, count);
  return false;
}

/** The right code: nothing to count any more. */
export function clearCodeTries(customerId) {
  wrongTries.delete(idKey(customerId));
}

/** Tests only. */
export function resetSignInCodeLimits() {
  wrongTries.clear();
  sends.clear();
}
