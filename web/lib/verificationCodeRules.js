/**
 * /admin/codes rules (2026-11-24), pure so they can be tested without a
 * database. The SQL is lib/verificationCodes.js.
 */

/** Rows are deleted after this, by the writer itself. */
export const CODE_LOG_KEEP_HOURS = 24;
/** What the page shows. */
export const CODE_LOG_SHOW_MINUTES = 60;
/** Every code this product sends is valid 10 minutes (lib/authCrypto.js OTP_TTL_MS). */
export const CODE_VALID_MINUTES = 10;

const PURPOSES = {
  'customer-auth': 'customer',
  'agent-auth': 'agent',
  'reset-password': 'reset',
  'phone-change': 'phoneChange',
};

/** The sender's label → what the page calls it ('other' for an unknown label). */
export function codePurposeKind(purpose) {
  return PURPOSES[purpose] || 'other';
}

/**
 * Still usable? A code is valid 10 minutes from when it was sent — a later
 * code for the same number replaces it, which this cannot know, so the page
 * says "le plus récent" on the newest row per number.
 *
 * @param {Date|string} sentAt
 * @param {number} [now]
 */
export function codeStillValid(sentAt, now = Date.now()) {
  const at = new Date(sentAt).getTime();
  return Number.isFinite(at) && now - at < CODE_VALID_MINUTES * 60 * 1000;
}

/** The id of the newest row per number (the code that counts for that number). */
export function newestPerPhone(rows) {
  const seen = new Set();
  const newest = new Set();
  for (const row of rows) {
    if (seen.has(row.phone)) continue;
    seen.add(row.phone);
    newest.add(row.id);
  }
  return newest;
}
