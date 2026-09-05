/**
 * services/scheduler.js
 *
 * The one always-on process in this system, doing the one job nothing else
 * can: firing the weekly customer alert sweep.
 *
 * WHY HERE
 * The sweep itself already existed and was already correct
 * (web/app/api/cron/search-alerts/route.js — it re-runs every saved search
 * through the same getListings() the /listings page uses and WhatsApps the
 * owner about genuinely new matches). What it never had was anything to call
 * it. Its own doc comment says so: "Not self-scheduling: this route has no
 * cron of its own (a Next.js app has no persistent background process to host
 * one in), so it's a plain secret-protected endpoint meant to be called
 * periodically by something outside this app."
 *
 * That something is this. The engine is a long-lived single-instance PM2 fork
 * (see ecosystem.config.js — deliberately not cluster mode, because it holds
 * per-sender state in memory), which makes it the only component here that
 * can hold a timer without either duplicating work across workers or dying
 * between requests. The alternative was a VPS crontab entry, which works but
 * lives outside the repository, is invisible in code review, and silently
 * disappears the day the box is rebuilt.
 *
 * IDEMPOTENCE ACROSS RESTARTS
 * A naive setInterval re-fires the sweep on every deploy that happens to land
 * in the firing window — and this sweep sends real WhatsApp messages to real
 * customers. Each run is therefore recorded in `job_runs`, and a run is
 * skipped when one already succeeded within the interval. A deploy in the
 * middle of Monday morning is a no-op, not a second round of alerts.
 */

const db = require('./db');

/**
 * Local-time day (0 = Sunday) and hour the weekly sweep should fire.
 * Monday 09:00 by default — Kinshasa is UTC+1, and the server clock is what
 * this reads, so a UTC box fires at 10:00 local. Env-driven precisely so that
 * can be corrected without a deploy.
 */
const WEEKLY_DAY = Number.parseInt(process.env.SEARCH_ALERT_DAY, 10);
const WEEKLY_HOUR = Number.parseInt(process.env.SEARCH_ALERT_HOUR, 10);
const ALERT_DAY = Number.isFinite(WEEKLY_DAY) ? WEEKLY_DAY : 1;
const ALERT_HOUR = Number.isFinite(WEEKLY_HOUR) ? WEEKLY_HOUR : 9;

/** How often the clock is checked. Fine-grained enough to hit the hour, cheap enough to ignore. */
const TICK_MS = 10 * 60 * 1000;

/**
 * Minimum gap between two successful sweeps. Six days rather than seven so a
 * tick that lands a few minutes early, or a week where the process restarted
 * across the window, still fires — while remaining far too long to ever send
 * a customer two alert messages in the same week.
 */
const MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;

const JOB_NAME = 'search-alerts-weekly';

function webBaseUrl() {
  return (process.env.WEB_BASE_URL || process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

/**
 * Runs the sweep by calling the storefront's own endpoint, rather than
 * reimplementing it here.
 *
 * That endpoint owns the saved searches, the listing query, the
 * already-notified bookkeeping and the WhatsApp template parameters — all of
 * which live in Postgres and in web/'s own modules. A second implementation
 * in this repo would be a second definition of "a new match", free to drift
 * from the one customers actually see on their Alertes tab.
 */
async function runSearchAlertSweep() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('CRON_SECRET is not set — the alert endpoint would reject this call');
  }

  const url = `${webBaseUrl()}/api/cron/search-alerts`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    // The sweep walks every saved search and makes a WhatsApp call per hit,
    // so it is genuinely slow. Long timeout, and it only ever runs weekly.
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`alert sweep returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/**
 * Is it time, and has it not already run?
 *
 * The day/hour test is a window, not an instant: ticks are 10 minutes apart
 * and the process may start at any point, so "the configured hour, any
 * minute" is the condition. MIN_GAP_MS is what stops the six ticks inside
 * that hour from firing six sweeps.
 */
function shouldRunNow(now = new Date()) {
  if (now.getDay() !== ALERT_DAY || now.getHours() !== ALERT_HOUR) return false;
  const last = db.getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= MIN_GAP_MS;
}

async function tick() {
  if (!shouldRunNow()) return;

  console.log(`[scheduler] running ${JOB_NAME}`);
  try {
    const result = await runSearchAlertSweep();
    db.recordJobRun(JOB_NAME, { ok: true, detail: JSON.stringify(result).slice(0, 500) });
    console.log(
      `[scheduler] ${JOB_NAME} done — ${result.notifiedSearches ?? 0} recherche(s), ` +
        `${result.notifiedListings ?? 0} bien(s) signalé(s)`,
    );
  } catch (err) {
    // Recorded as a FAILURE, which deliberately does not advance
    // `succeeded_at` — so the next tick inside the same window retries rather
    // than skipping the whole week because one attempt failed.
    db.recordJobRun(JOB_NAME, { ok: false, detail: err.message.slice(0, 500) });
    console.error(`[scheduler] ${JOB_NAME} failed: ${err.message}`);
  }
}

let timer = null;

/**
 * Starts the scheduler. Safe to call twice (the second call is a no-op), and
 * off by default in test runs so a verification suite never fires real
 * WhatsApp messages at real customers.
 */
function start() {
  if (timer) return timer;
  if (process.env.DISABLE_SCHEDULER === 'true' || process.env.NODE_ENV === 'test') {
    console.log('[scheduler] disabled');
    return null;
  }

  timer = setInterval(() => {
    tick().catch((err) => console.error(`[scheduler] tick failed: ${err.message}`));
  }, TICK_MS);
  // Never hold the process open on its own account — PM2 keeps this service
  // alive, and an unref'd timer means a manual `node index.js` still exits on
  // Ctrl-C rather than hanging on a ten-minute interval.
  timer.unref?.();

  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  console.log(
    `[scheduler] started — alertes clients chaque ${dayNames[ALERT_DAY] || ALERT_DAY} à ${ALERT_HOUR}h`,
  );
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  // Exposed for scripts/verify-pipeline.js.
  shouldRunNow,
  runSearchAlertSweep,
  JOB_NAME,
  ALERT_DAY,
  ALERT_HOUR,
  MIN_GAP_MS,
};
