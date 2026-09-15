/**
 * services/scheduler.js
 *
 * The one always-on process in this system, running every job that needs a
 * clock rather than a request.
 *
 * WHY HERE
 * The weekly alert sweep already existed and was already correct
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
 * ONE TICK, MANY JOBS
 * This used to be a single hardcoded weekly sweep on a ten-minute interval.
 * That interval is the reason it could not host anything else: a 15-minute
 * response SLA checked every 10 minutes fires somewhere between 15 and 25
 * minutes late, which is not a 15-minute SLA. The tick is now 60 seconds and
 * the work is a list of jobs, each deciding for itself whether it is due.
 *
 * TWO KINDS OF IDEMPOTENCE, AND THEY ARE NOT INTERCHANGEABLE
 *   - `job_runs` answers "did this SWEEP run recently?". It is keyed by job
 *     NAME, one row per job, so it can gate a weekly sweep and nothing finer.
 *     A naive setInterval re-fires the alert sweep on every deploy that lands
 *     in the firing window, and that sweep sends real WhatsApp messages to
 *     real customers.
 *   - Per-ENTITY idempotence ("have we already alerted on viewing request
 *     #47?") cannot live in job_runs and does not. It lives in columns on the
 *     row itself — `viewing_requests.sla_alerted_at`, `.checkin_sent_at`.
 *     Confusing the two would either spam one customer or skip every other
 *     one.
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

/**
 * How often the clock is checked.
 *
 * 60 seconds, down from 10 minutes. The weekly sweep never needed the
 * resolution — but the viewing-request SLA does, and a tick coarser than the
 * deadline it enforces cannot enforce it. The cost is one cheap indexed
 * SQLite read per job per minute; the weekly sweep's own gate is a single
 * `job_runs` lookup that returns immediately outside its hour.
 */
const TICK_MS = 60 * 1000;

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
 * The day/hour test is a window, not an instant: the process may start at any
 * point, so "the configured hour, any minute" is the condition. MIN_GAP_MS is
 * what stops the sixty ticks inside that hour from firing sixty sweeps.
 */
function shouldRunNow(now = new Date()) {
  if (now.getDay() !== ALERT_DAY || now.getHours() !== ALERT_HOUR) return false;
  const last = db.getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= MIN_GAP_MS;
}

/**
 * The registry.
 *
 * A job is `{ name, shouldRun(now), run() }`. `shouldRun` must be CHEAP — it
 * is called once a minute per job, forever — and is where "is there anything
 * to do?" belongs, so that `job_runs` records real work rather than a
 * heartbeat. `run` returns anything JSON-serialisable; it lands in
 * `job_runs.detail` truncated to 500 chars.
 *
 * Order is registration order, and jobs run sequentially within a tick: they
 * share one SQLite connection and one WhatsApp sender, and a tick that fanned
 * them out in parallel would interleave sends for no benefit at this volume.
 */
const JOBS = [];

function registerJob(job) {
  if (!job?.name || typeof job.shouldRun !== 'function' || typeof job.run !== 'function') {
    throw new Error('a job needs { name, shouldRun(now), run() }');
  }
  if (JOBS.some((existing) => existing.name === job.name)) {
    throw new Error(`job '${job.name}' is already registered`);
  }
  JOBS.push(job);
  return job;
}

registerJob({
  name: JOB_NAME,
  shouldRun: shouldRunNow,
  run: async () => {
    const result = await runSearchAlertSweep();
    console.log(
      `[scheduler] ${JOB_NAME} done — ${result.notifiedSearches ?? 0} recherche(s), ` +
        `${result.notifiedListings ?? 0} bien(s) signalé(s)`,
    );
    return result;
  },
});

/**
 * Speed-to-lead: the 15-minute unanswered-request escalation and the 2-hour
 * post-visit check-in.
 *
 * Required lazily, inside this block rather than at the top of the file,
 * because services/viewingSweeps.js requires services/viewingNotifications.js
 * which requires services/chakra.js — a chain that has no business running
 * just because something imported the scheduler to read ALERT_DAY.
 */
{
  // eslint-disable-next-line global-require
  const { slaJob, checkinJob } = require('./viewingSweeps');
  registerJob(slaJob);
  registerJob(checkinJob);
}

/**
 * Pushed operational alerts: every five minutes, compare the engine's own
 * health report with the open incidents and tell the desk what changed. Last,
 * so a slow Postgres probe never delays the SLA sweep. See services/opsAlerts.js.
 */
{
  // eslint-disable-next-line global-require
  const { opsAlertJob } = require('./opsAlerts');
  registerJob(opsAlertJob);
}

/**
 * Agent-dashboard analytics rollup: every ten minutes, recount the recent
 * days of listing views / taps / saves into listing_stats_daily. Registered
 * after everything customer- or ops-facing, because it is the one job whose
 * lateness costs nothing but a slower dashboard (web falls back to raw
 * tables). See services/listingStatsRollup.js.
 */
{
  // eslint-disable-next-line global-require
  const { listingStatsRollupJob } = require('./listingStatsRollup');
  registerJob(listingStatsRollupJob);
}

/**
 * Runs one job if it is due, recording the outcome.
 *
 * Isolated per job on purpose: a throw in the SLA sweep must not stop the
 * post-visit check-in behind it, and neither must stop next minute's tick.
 */
async function runJob(job, now = new Date()) {
  let due;
  try {
    due = job.shouldRun(now);
  } catch (err) {
    console.error(`[scheduler] ${job.name} shouldRun failed: ${err.message}`);
    return false;
  }
  if (!due) return false;

  console.log(`[scheduler] running ${job.name}`);
  try {
    const result = await job.run();
    db.recordJobRun(job.name, { ok: true, detail: JSON.stringify(result ?? {}).slice(0, 500) });
    return true;
  } catch (err) {
    // Recorded as a FAILURE, which deliberately does not advance
    // `succeeded_at` — so the next tick inside the same window retries rather
    // than skipping the whole week because one attempt failed.
    db.recordJobRun(job.name, { ok: false, detail: err.message.slice(0, 500) });
    console.error(`[scheduler] ${job.name} failed: ${err.message}`);
    return true;
  }
}

async function tick(now = new Date()) {
  for (const job of JOBS) {
    // Sequential, and each already swallows its own failure.
    await runJob(job, now);
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
  // Ctrl-C rather than hanging on the interval.
  timer.unref?.();

  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  console.log(
    `[scheduler] started — ${JOBS.length} job(s), tick ${TICK_MS / 1000}s; ` +
      `alertes clients chaque ${dayNames[ALERT_DAY] || ALERT_DAY} à ${ALERT_HOUR}h`,
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
  TICK_MS,
  // The multi-job runner.
  registerJob,
  runJob,
  tick,
  JOBS,
};
