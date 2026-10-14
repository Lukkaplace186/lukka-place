'use client';

import { useEffect } from 'react';

/**
 * Brings one element into view once, after the page has painted — for a deep
 * link that names a card (a WhatsApp template's link button can carry
 * `?visite=47`, but not a `#fragment`). Renders nothing; does nothing when the
 * element is not on the page.
 */
export default function ScrollToElement({ id }) {
  useEffect(() => {
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [id]);
  return null;
}
