'use client';

import { useSyncExternalStore } from 'react';

/**
 * Client-side "am I logged in?" check for picking a code path — never for
 * authorization. Reads a small, deliberately non-httpOnly flag cookie
 * (`lukka_logged_in=1`) set/cleared alongside the real httpOnly session
 * cookie by loginAction/signupAction/logoutAction (app/(site)/compte/*
 * actions). The real session cookie stays httpOnly and is never read here.
 *
 * Every /api/account/* route re-verifies the real session server-side via
 * getCurrentCustomerId() regardless of what this returns — a forged or
 * stale flag cookie can only route a visitor to the wrong (failing) code
 * path, never grant access to anything.
 */
export function isLoggedInClient() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c === 'lukka_logged_in=1');
}

function subscribeNoop() {
  // Login state never changes without a full navigation (loginAction /
  // logoutAction both redirect()), which remounts the tree — there is
  // nothing to subscribe to within one mounted session.
  return () => {};
}

/**
 * useSyncExternalStore, not useEffect+useState: reads the login flag once,
 * matches this app's own established pattern for "value differs between
 * server and client, constant for the component's lifetime otherwise" (see
 * FavoriteButton.js's localStorage reads). Server snapshot is always
 * `false` (no cookies during SSR), so this can never cause a hydration
 * mismatch — only a post-mount flip if the visitor turns out to be logged
 * in, same as every other localStorage-backed read in this app.
 */
export function useIsLoggedIn() {
  return useSyncExternalStore(subscribeNoop, isLoggedInClient, () => false);
}
