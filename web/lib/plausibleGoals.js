/**
 * Plausible custom events (2026-11-21). Plausible (app/layout.js) counted
 * page views only: nothing told it a visitor tapped WhatsApp, opened an
 * account or created an alert, so its sources could not be compared on what
 * matters. Each name below must ALSO be added as a goal in the Plausible
 * dashboard (Site settings → Goals → Custom event, exact spelling), or
 * Plausible receives the event and shows nothing.
 *
 * Fired only on a confirmed success, never on a submit:
 *  - `WhatsApp tap`     lib/analyticsClient.js trackLeadClick (the tap itself
 *                       is the conversion; WhatsApp opens right after).
 *  - `Account created`  a customer account the server just created
 *                       (compte/inscription) or activated (compte/activer,
 *                       an account opened on WhatsApp gets its password).
 *                       The server queues it in `lp_goal`
 *                       (lib/plausibleGoalServer.js); components/
 *                       PlausibleGoals.js fires it on the next page.
 *  - `Alert created`    a saved search the server answered `added` for
 *                       (lib/accountFavorites.js), or the alert a "Mon
 *                       projet" created (queued like an account).
 *
 * Pure apart from firePlausibleGoal, which only touches `window.plausible`
 * and never throws: Plausible blocked, not loaded or broken changes nothing
 * for the visitor.
 */

export const PLAUSIBLE_GOALS = Object.freeze({
  WHATSAPP_TAP: 'WhatsApp tap',
  ACCOUNT_CREATED: 'Account created',
  ALERT_CREATED: 'Alert created',
});

const GOAL_NAMES = Object.values(PLAUSIBLE_GOALS);

/** Server-queued goals (`["Account created", …]`), drained by the next page. */
export const GOAL_QUEUE_COOKIE = 'lp_goal';
export const GOAL_QUEUE_MAX_AGE = 600;
const GOAL_QUEUE_MAX = 5;

export function isPlausibleGoal(name) {
  return GOAL_NAMES.includes(name);
}

/** Props Plausible accepts: a few short string/number values, nothing else. */
export function cleanGoalProps(props) {
  if (!props || typeof props !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(props).slice(0, 5)) {
    if (!/^[a-z_]{1,30}$/.test(key)) continue;
    if (typeof value === 'string' && value && value.length <= 60) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Sends one goal to Plausible. Unknown names are ignored. Never throws. */
export function firePlausibleGoal(name, props = null) {
  if (!isPlausibleGoal(name)) return false;
  try {
    if (typeof window === 'undefined') return false;
    // An effect can run before app/layout.js's afterInteractive stub: install
    // Plausible's own queue shim (same code), which the script replays from
    // `plausible.q` once it loads. Blocked, the queue just stays in memory.
    if (typeof window.plausible !== 'function') {
      window.plausible = function plausibleQueue() {
        (window.plausible.q = window.plausible.q || []).push(arguments);
      };
    }
    const clean = cleanGoalProps(props);
    window.plausible(name, clean ? { props: clean } : undefined);
    return true;
  } catch {
    return false;
  }
}

/** The queue cookie's content, bounded: known goal names only, at most five. */
export function parseGoalQueue(value) {
  try {
    const list = JSON.parse(decodeURIComponent(String(value || '')));
    return (Array.isArray(list) ? list : [])
      .map((entry) => (typeof entry === 'string' ? { n: entry } : entry))
      .filter((entry) => isPlausibleGoal(entry?.n))
      .slice(0, GOAL_QUEUE_MAX)
      .map((entry) => ({ n: entry.n, ...(cleanGoalProps(entry.p) ? { p: cleanGoalProps(entry.p) } : {}) }));
  } catch {
    return [];
  }
}

/** The cookie value after adding one goal (the last five kept). */
export function appendGoalQueue(value, name, props = null) {
  if (!isPlausibleGoal(name)) return encodeURIComponent(JSON.stringify(parseGoalQueue(value)));
  const clean = cleanGoalProps(props);
  const queue = [...parseGoalQueue(value), { n: name, ...(clean ? { p: clean } : {}) }].slice(-GOAL_QUEUE_MAX);
  return encodeURIComponent(JSON.stringify(queue));
}
