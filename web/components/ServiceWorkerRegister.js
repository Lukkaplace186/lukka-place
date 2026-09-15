'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js — production only, after the page has loaded, so
 * registration never competes with the first paint on a slow phone. See the
 * header of public/sw.js for exactly what the worker does (and does not).
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch((err) => {
        console.warn('[sw] registration failed', err);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return undefined;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
