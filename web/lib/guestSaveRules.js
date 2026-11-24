/**
 * Saving homes without an account (UX pass 2026-11-12, replaces "a guest's
 * heart always opens the sign-in prompt"): a visitor keeps up to
 * GUEST_FAVORITE_LIMIT homes on this device (lib/localFavorites.js); the save
 * that reaches the limit is kept AND asks them to sign in, with the reason;
 * past it, the heart asks first. Signing in merges the device's homes into
 * the account (mergeAnonymousData, on both the password and WhatsApp paths).
 */

export const GUEST_FAVORITE_LIMIT = 3;

/**
 * What a guest's tap on the heart does.
 * @param {number} savedCount homes already saved on this device
 * @param {boolean} alreadySaved whether this home is one of them
 * @returns {'unsave'|'save'|'save-and-ask'|'ask'}
 */
export function guestFavoriteDecision(savedCount, alreadySaved) {
  if (alreadySaved) return 'unsave';
  const count = Math.max(0, Number(savedCount) || 0);
  if (count >= GUEST_FAVORITE_LIMIT) return 'ask';
  if (count + 1 >= GUEST_FAVORITE_LIMIT) return 'save-and-ask';
  return 'save';
}
