'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { GOAL_QUEUE_COOKIE, firePlausibleGoal, parseGoalQueue } from '@/lib/plausibleGoals';

/**
 * Fires the Plausible goals a Server Action queued in `lp_goal` (an account
 * or an alert just created — lib/plausibleGoalServer.js) on the page the
 * visitor lands on next, then clears the cookie so each fires once. Mounted
 * once in app/layout.js beside Plausible's own stub; renders nothing.
 */
export default function PlausibleGoals() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      const raw = new RegExp(`(?:^|;\\s*)${GOAL_QUEUE_COOKIE}=([^;]+)`).exec(document.cookie)?.[1];
      if (!raw) return;
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${GOAL_QUEUE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
      for (const goal of parseGoalQueue(raw)) firePlausibleGoal(goal.n, goal.p || null);
    } catch {
      // Cookies refused or Plausible blocked: nothing to measure, nothing breaks.
    }
  }, [pathname]);

  return null;
}
