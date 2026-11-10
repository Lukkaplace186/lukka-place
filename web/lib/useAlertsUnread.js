'use client';

import { useEffect, useState } from 'react';
import { ALERTS_CHANGED_EVENT } from './appBridge';

const POLL_MS = 30_000;

/**
 * Unread app alerts for the Alertes badge (GET /api/push/unread): every 30 s
 * while visible, on return to the tab, and at once when a push arrives in
 * the foreground (lib/appBridge.js). Same shape as lib/useChatUnread.js.
 */
export function useAlertsUnread({ initial = 0, side = 'agent' } = {}) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const response = await fetch(`/api/push/unread?as=${side === 'customer' ? 'customer' : 'agent'}`, { credentials: 'same-origin', cache: 'no-store' });
        if (response.ok) {
          const body = await response.json();
          if (!stopped) setCount(Number(body.unread) || 0);
        }
      } catch {
        // Offline: keep the last count.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener(ALERTS_CHANGED_EVENT, load);
    document.addEventListener('visibilitychange', load);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(ALERTS_CHANGED_EVENT, load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [side]);

  return Number(count) || 0;
}
