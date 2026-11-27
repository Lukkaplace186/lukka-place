/**
 * Pure rules for "Continuer avec WhatsApp" (app/(site)/compte/connexion/whatsappActions.js).
 */

/** Where to go after signing in: a same-site path only, else the Espace Client. */
export function safeSignInNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/compte/client';
}

/**
 * The name a new account is opened with: trimmed, single-spaced, 2–80
 * characters with at least two letters. Null when it is not a name.
 */
export function cleanFullName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return null;
  if ((name.match(/\p{L}/gu) || []).length < 2) return null;
  return name;
}

/** An account opened in the last hour: its first proof is its registration. */
export function isNewAccount(createdAt, now = Date.now()) {
  const at = createdAt ? new Date(createdAt).getTime() : NaN;
  return Number.isFinite(at) && now - at >= 0 && now - at < 60 * 60 * 1000;
}

/**
 * The stored password of an account opened without one (2026-11-21).
 * `customers.password_hash` is NOT NULL in production, so the NULL this flow
 * used to insert failed every new account with 23502 (25 times for 17
 * numbers, 2026-11-16 → 21). '!whatsapp' is the engine's own marker for an
 * account opened on WhatsApp (services/customerOnboarding.js): it has no
 * `salt:hash` colon, so lib/authCrypto.js refuses every password against it,
 * and a password reset replaces it with a real hash.
 */
export const NO_PASSWORD_HASH = '!whatsapp';

/** What createCustomer stores: the real hash, or the no-password marker. */
export function storedPasswordHash(passwordHash) {
  return typeof passwordHash === 'string' && passwordHash.trim() ? passwordHash : NO_PASSWORD_HASH;
}

/** SQL (alias `c`): the row holds a real password — not NULL, not empty, not a '!' marker. */
export const HAS_PASSWORD_SQL = "(c.password_hash IS NOT NULL AND c.password_hash <> '' AND c.password_hash NOT LIKE '!%')";
