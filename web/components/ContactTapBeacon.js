'use client';

import { useEffect } from 'react';
import { contactTapPayload } from '@/lib/contactTapAttrs';

/**
 * Reports a tap on a direct "WhatsApp" / "Appeler" link to an agent that is
 * not on a listing (lib/contactTapAttrs.js: profile, directory, project,
 * Espace Client). One listener for the whole page, so the links themselves
 * stay plain server-rendered anchors. sendBeacon survives the navigation to
 * WhatsApp; nothing is shown and a failure is silent — the link always opens.
 */
export default function ContactTapBeacon() {
  useEffect(() => {
    function onClick(event) {
      const link = event.target?.closest?.('a[data-contact-tap]');
      if (!link) return;
      const payload = contactTapPayload(link.dataset);
      if (!payload) return;
      try {
        const body = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        if (!navigator.sendBeacon?.('/api/telemetry/contact-tap', body)) {
          fetch('/api/telemetry/contact-tap', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
        }
      } catch {
        // Never in the way of the link.
      }
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
