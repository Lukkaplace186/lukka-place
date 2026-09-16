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
 * Local-time hour the daily alert sweep fires. 09:00 by default — Kinshasa is
 * UTC+1, and the server clock is what this reads, so a UTC box fires at 10:00
 * local. Env-driven precisely so that can be corrected without a deploy.
 *
 * DAILY, NOT WEEKLY. Each saved search now carries its own frequency
 * (customer_saved_searches.alert_frequency: daily / weekly / off), and the web
 * sweep skips a search whose last alert is too recent for its frequency. A
 * weekly sweep could not honour "chaque jour"; a daily one honours both.
 * SEARCH_ALERT_DAY is no longer read.
 */
const CONFIGURED_HOUR = Number.parseInt(process.env.SEARCH_ALERT_HOUR, 10);
const ALERT_HOUR = Number.isFinite(CONFIGURED_HOUR) ? CONFIGURED_HOUR : 9;

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
 * Minimum gap between two successful sweeps. 20 hours rather than 24 so a tick
 * that lands a few minutes early still fires the next day — while the sixty
 * ticks inside the firing hour can never start a second sweep. A customer is
 * protected from repeats twice over below that: per search by
 * `last_alerted_at` against its frequency, and per listing by
 * saved_search_notifications' UNIQUE (saved_search_id, property_id).
 */
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

/**
 * Renamed from 'search-alerts-weekly' with the move to a daily cadence. The old
 * job_runs row simply stops being written; nothing reads it.
 */
const JOB_NAME = 'search-alerts';

/**
 * The web endpoint works in chunks (one page of saved searches per call, under
 * a time budget) and returns a cursor; the sweep calls it until it says done.
 * This bounds a runaway: at 200 searches a chunk it is 100,000 searches.
 */
const MAX_SWEEP_CHUNKS = 500;

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
async function runSearchAlertSweep({ fetchImpl = fetch } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('CRON_SECRET is not set — the alert endpoint would reject this call');
  }

  const url = `${webBaseUrl()}/api/cron/search-alerts`;
  const totals = { chunks: 0, checked: 0, notifiedSearches: 0, notifiedListings: 0, errors: 0 };
  let cursor = null;

  // One request used to walk every saved search in a single HTTP call with a
  // five-minute timeout — fine at a few hundred searches, and a guaranteed
  // timeout long before 100,000. Each chunk is now short, and a failure part
  // way through retries on the next tick from the start: already-sent listings
  // are skipped by the web side's per-listing bookkeeping, so a retry resends
  // nothing.
  for (let chunk = 0; chunk < MAX_SWEEP_CHUNKS; chunk += 1) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor }),
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`alert sweep returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    }

    totals.chunks += 1;
    totals.checked += Number(body.checked) || 0;
    totals.notifiedSearches += Number(body.notifiedSearches) || 0;
    totals.notifiedListings += Number(body.notifiedListings) || 0;
    totals.errors += Array.isArray(body.errors) ? body.errors.length : 0;

    // A cursor that does not move would loop forever on the same page.
    if (body.done || body.cursor == null || body.cursor === cursor) return totals;
    cursor = body.cursor;
  }
  throw new Error(`alert sweep did not finish within ${MAX_SWEEP_CHUNKS} chunks`);
}

/**
 * Is it time, and has it not already run?
 *
 * The day/hour test is a window, not an instant: the process may start at any
 * point, so "the configured hour, any minute" is the condition. MIN_GAP_MS is
 * what stops the sixty ticks inside that hour from firing sixty sweeps.
 */
function shouldRunNow(now = new Date()) {
  if (now.getHours() !== ALERT_HOUR) return false;
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
 * The daily sales commission run (launch policy + subscription plan). Like the
 * alert sweep it calls web's own endpoint rather than reimplementing the rules:
 * the tiers, the confirmed-listing definition and the ledger all live in
 * web/lib/salesLaunch.js and web/lib/sales.js, and the run is idempotent there
 * (UNIQUE ledger keys), so a retry never pays anything twice.
 *
 * Fires in the Kinshasa hour SALES_COMMISSION_HOUR (default 6), read against
 * UTC so the server's own clock does not move it; MIN_GAP_MS stops the sixty
 * ticks inside that hour from running it sixty times.
 */
const SALES_JOB_NAME = 'sales-commissions';
const CONFIGURED_SALES_HOUR = Number.parseInt(process.env.SALES_COMMISSION_HOUR, 10);
const SALES_HOUR_KINSHASA = Number.isFinite(CONFIGURED_SALES_HOUR) ? CONFIGURED_SALES_HOUR : 6;

function salesCommissionsDue(now = new Date()) {
  if (now.getUTCHours() !== (SALES_HOUR_KINSHASA + 23) % 24) return false;
  const last = db.getLastJobRun(SALES_JOB_NAME);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= MIN_GAP_MS;
}

async function runSalesCommissions({ fetchImpl = fetch } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set — the commission endpoint would reject this call');
  const response = await fetchImpl(`${webBaseUrl()}/api/cron/sales-commissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`commission run returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

registerJob({ name: SALES_JOB_NAME, shouldRun: salesCommissionsDue, run: () => runSalesCommissions() });

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

  console.log(
    `[scheduler] started — ${JOBS.length} job(s), tick ${TICK_MS / 1000}s; ` +
      `alertes clients chaque jour à ${ALERT_HOUR}h`,
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
  ALERT_HOUR,
  MIN_GAP_MS,
  MAX_SWEEP_CHUNKS,
  TICK_MS,
  // The daily sales commission run.
  SALES_JOB_NAME,
  SALES_HOUR_KINSHASA,
  salesCommissionsDue,
  runSalesCommissions,
  // The multi-job runner.
  registerJob,
  runJob,
  tick,
  JOBS,
};
