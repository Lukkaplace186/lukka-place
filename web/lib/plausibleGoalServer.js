import 'server-only';
import { cookies } from 'next/headers';
import { DEMO_COOKIE, isDemoPhone } from './demoPhone';
import { GOAL_QUEUE_COOKIE, GOAL_QUEUE_MAX_AGE, appendGoalQueue, isPlausibleGoal } from './plausibleGoals';

/**
 * From a Server Action that just created something (an account, an alert):
 * queue a Plausible goal in `lp_goal` for components/PlausibleGoals.js to
 * fire on the next page (lib/plausibleGoals.js). Plausible is cookieless and
 * needs no consent; this cookie holds goal names only, for ten minutes.
 * A demo account is never counted. Never throws.
 */
export async function queuePlausibleGoal(name, { phone = null, props = null } = {}) {
  if (!isPlausibleGoal(name) || isDemoPhone(phone)) return;
  try {
    const cookieStore = await cookies();
    if (cookieStore.get(DEMO_COOKIE)) return;
    cookieStore.set(GOAL_QUEUE_COOKIE, appendGoalQueue(cookieStore.get(GOAL_QUEUE_COOKIE)?.value, name, props), {
      path: '/', maxAge: GOAL_QUEUE_MAX_AGE, sameSite: 'lax', httpOnly: false, secure: process.env.NODE_ENV === 'production',
    });
  } catch (err) {
    console.error(`[plausible] goal ${name} not queued: ${err.message}`);
  }
}
