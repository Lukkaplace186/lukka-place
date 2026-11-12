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
