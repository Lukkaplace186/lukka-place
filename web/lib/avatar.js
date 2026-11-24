/**
 * The person's mark in the app (components/app/AppAvatar.js), as pure rules
 * the tests can load without JSX.
 */

/** "AO" from "Amara Okafor": letters only (an agent's username can be their phone digits). */
export function initialsOf(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter((word) => /^[A-Za-zÀ-ÿ]/.test(word));
  if (!words.length) return null;
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** Only a real web address is tried as a photo: agents.image can hold a bare filename. */
export function avatarSrc(value) {
  const src = String(value || '').trim();
  return /^https?:\/\//i.test(src) ? src : null;
}
