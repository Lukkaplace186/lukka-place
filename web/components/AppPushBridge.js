'use client';

import { useEffect } from 'react';
import { startAppPush } from '@/lib/appBridge';

/**
 * Mounted in the agent layout (`side="agent"`) and the Espace Client layout
 * (`side="customer"`). Inside the Lukka Place app it asks for notification
 * permission once and registers this phone for that account
 * (lib/appBridge.js); in a browser it does nothing and renders nothing.
 */
export default function AppPushBridge({ side = 'agent' }) {
  useEffect(() => {
    startAppPush({ ask: true, side }).catch(() => {});
  }, [side]);
  return null;
}
