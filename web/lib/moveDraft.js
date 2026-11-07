/**
 * The signup cards' draft in localStorage (components/MoveOnboarding.js).
 * Kept until the account really exists: cleared by components/ClearMoveDraft.js
 * inside the signed-in portal, never on submit — a sign-up the server refuses
 * (number already registered, invalid number) must not lose the answers
 * (found 2026-11-07, before the campaign). Every access is guarded: a private
 * window or blocked storage just means no resume.
 */
export const MOVE_DRAFT_KEY = 'lukka_move_draft_v2';

export function readMoveDraft() {
  try {
    const raw = window.localStorage.getItem(MOVE_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeMoveDraft(value) {
  try {
    window.localStorage.setItem(MOVE_DRAFT_KEY, JSON.stringify(value));
  } catch {
    // no resume, nothing else lost
  }
}

export function clearMoveDraft() {
  try {
    window.localStorage.removeItem(MOVE_DRAFT_KEY);
  } catch {
    // ignore
  }
}
