'use client';

import { useEffect, useRef } from 'react';

/**
 * Back closes the overlay instead of leaving the page (UX pass 2026-11-12).
 *
 * While `open`, one history entry is pushed for the overlay; Android's back
 * button (Capacitor calls the web view's goBack), the browser's back and the
 * iPhone edge swipe pop it, and `onClose` runs — the screen underneath, its
 * scroll and its filters stay as they were. Closed any other way (the ✕,
 * Escape, a tap outside), the hook takes its own entry back off, so the
 * person never needs two backs to leave. If the overlay closed because a link
 * navigated away, the current entry is no longer ours and nothing is undone.
 *
 * The pushed state keeps whatever is already there (the Next.js router's own
 * fields included) and adds one marker.
 */
export function useBackToClose(open, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Set by `release()`: the overlay is closing because the page is about to
  // navigate (e.g. "Voir N biens"), so its entry must not be taken back — a
  // back() racing the router's push could undo the navigation.
  const released = useRef(false);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const marker = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let poppedByBack = false;
    released.current = false;
    window.history.pushState({ ...(window.history.state || {}), __lkpOverlay: marker }, '');

    const onPop = () => {
      if (window.history.state?.__lkpOverlay === marker) return; // forward onto our own entry
      poppedByBack = true;
      onCloseRef.current?.();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!poppedByBack && !released.current && window.history.state?.__lkpOverlay === marker) window.history.back();
    };
  }, [open]);

  return function release() {
    released.current = true;
  };
}
