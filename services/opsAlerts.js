/**
 * services/opsAlerts.js
 *
 * Pushed operational alerts: the engine watches its own health report and
 * tells the desk when something breaks — and again when it recovers.
 *
 * WHAT COUNTS AS AN ALERT
 * Only conditions the engine can observe for itself, from the same report the
 * console's /admin/health page reads (db.getEngineHealth):
 *   - a scheduled job whose last run failed and has not succeeded since;
 *   - Postgres unreachable from the engine (critical: publishing, matching and
 *     every listing read go through it);
 *   - no inbound WhatsApp traffic at all for OPS_ALERT_SILENCE_HOURS (24 by
 *     default) — how a dead webhook shows itself before a customer complains.
 *     A database that has never received a message is not "silent"; a fresh
 *     install does not page anybody;
 *   - OPS_ALERT_FAILED_PUSHES (3 by default) or more refused agency alerts in
 *     the last 24 hours.
 *
 * ONE MESSAGE PER INCIDENT, NOT PER MINUTE
 * Each condition is an incident row in `ops_alerts`, keyed by `alert_key`, with
 * a partial unique index allowing one OPEN row per key. The sweep opens a row
 * when a condition appears, leaves it alone while it persists, and resolves it
 * when the condition clears. The desk hears about the opening and the
 * resolution, never the thirty sweeps in between.
 *
 * WHEN NOBODY CAN BE TOLD
 * OPS_WHATSAPP_NUMBER is unset on production. The incident is still opened and
 * shows on /admin/health and the console's sidebar badge — that is where it
 * lands until a number exists. Nothing is marked "notified" that was not sent,
 * and an incident opened while the number was unset is sent once a number is
 * configured, if it is still open. A resolution is only announced for an
 * incident the desk was actually told about.
 *
 * Same 24-hour limit as every other session message (CLAUDE.md, "Outbound
 * WhatsApp"): a desk handset that has not messaged the business number in the
 * last day will not receive these.
 */

const db = require('./db');

const OPS_ALERT_JOB = 'ops-health-alerts';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
// A failed send is retried at most this often, not on every sweep.
const NOTIFY_RETRY_MS = 60 * 60 * 1000;
const POSTGRES_TIMEOUT_MS = 10 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function opsNumber() {
  return (process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '') || null;
}

function positiveEnv(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** SQLite's CURRENT_TIMESTAMP text is UTC with no zone marker. */
function toInstant(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The alerts a health report describes right now. Pure.
 *
 * @param {ReturnType<typeof db.getEngineHealth>} health
 * @param {{now?: number, postgres?: {configured: boolean, ok?: boolean, error?: string}|null}} [options]
 * @returns {{key: string, severity: 'critical'|'warning', message: string}[]}
 */
function evaluateHealth(health, { now = Date.now(), postgres = null } = {}) {
  const alerts = [];

  if (postgres?.configured && !postgres.ok) {
    alerts.push({
      key: 'postgres:unreachable',
      severity: 'critical',
      message: `Postgres est injoignable depuis le moteur : ${String(postgres.error || 'erreur inconnue').slice(0, 160)}`,
    });
  }

  for (const job of health?.jobs || []) {
    // This sweep does not alert on itself: if it is failing it cannot be
    // trusted to say so, and /admin/health already lists it.
    if (job.name === OPS_ALERT_JOB) continue;
    const failing = job.last_error && (!job.succeeded_at || job.last_run_at > job.succeeded_at);
    if (failing) {
      alerts.push({
        key: `job:${job.name}`,
        severity: 'warning',
        message: `La tâche planifiée « ${job.name} » échoue : ${String(job.last_error).slice(0, 160)}`,
      });
    }
  }

  const silenceHours = positiveEnv('OPS_ALERT_SILENCE_HOURS', 24);
  const newest = [toInstant(health?.traffic?.lastInboundMessageAt), toInstant(health?.traffic?.lastListingAt)]
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  if (newest && now - newest.getTime() > silenceHours * HOUR_MS) {
    const hours = Math.floor((now - newest.getTime()) / HOUR_MS);
    alerts.push({
      key: 'traffic:silent',
      severity: 'warning',
      message: `Aucun message WhatsApp reçu depuis ${hours} h. Vérifier que le webhook Chakra arrive toujours.`,
    });
  }

  const failedPushes = Number(health?.failures?.failedPushes24h) || 0;
  if (failedPushes >= positiveEnv('OPS_ALERT_FAILED_PUSHES', 3)) {
    alerts.push({
      key: 'sends:failed-pushes',
      severity: 'warning',
      message: `${failedPushes} alertes agences refusées par WhatsApp sur les dernières 24 h.`,
    });
  }

  return alerts;
}

async function checkPostgres() {
  // eslint-disable-next-line global-require
  const postgres = require('./postgres');
  if (!postgres.isConfigured()) return { configured: false };
  let timer;
  try {
    await Promise.race([
      postgres.getPool().query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${POSTGRES_TIMEOUT_MS / 1000}s`)), POSTGRES_TIMEOUT_MS);
      }),
    ]);
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function sendToOps(to, text) {
  // eslint-disable-next-line global-require
  return require('./chakra').sendWhatsAppMessage(to, text);
}

/**
 * One sweep: open, keep, resolve, and tell the desk what changed.
 *
 * @param {{now?: number, send?: Function, postgresCheck?: Function}} [deps]
 */
async function runOpsAlertSweep({ now = Date.now(), send = sendToOps, postgresCheck = checkPostgres } = {}) {
  const health = db.getEngineHealth();
  const postgres = await postgresCheck();
  const active = evaluateHealth(health, { now, postgres });
  const activeKeys = new Set(active.map((alert) => alert.key));
  const open = new Map(db.listOpenOpsAlerts().map((row) => [row.alert_key, row]));
  const to = opsNumber();
  const nowIso = new Date(now).toISOString();
  const result = { active: active.length, opened: [], resolved: [], notified: 0, notifyFailed: 0, opsConfigured: Boolean(to) };

  async function notify(row, text) {
    if (!to) return;
    try {
      await send(to, text);
      if (row) db.markOpsAlertNotified(row.id, { at: nowIso, error: null });
      result.notified += 1;
    } catch (err) {
      if (row) db.markOpsAlertNotified(row.id, { at: null, attemptedAt: nowIso, error: err.message });
      result.notifyFailed += 1;
      console.error(`[ops-alerts] could not reach the desk about ${row?.alert_key || 'a resolution'}: ${err.message}`);
    }
  }

  for (const alert of active) {
    const existing = open.get(alert.key);
    if (existing) {
      db.touchOpsAlert(existing.id, { message: alert.message, severity: alert.severity, at: nowIso });
      const lastAttempt = toInstant(existing.notify_attempted_at);
      const due = !existing.notified_at && (!lastAttempt || now - lastAttempt.getTime() >= NOTIFY_RETRY_MS);
      if (due) await notify(existing, `⚠️ Lukka Place — alerte (toujours en cours)\n${alert.message}`);
      continue;
    }
    const row = db.openOpsAlert({ key: alert.key, severity: alert.severity, message: alert.message, at: nowIso });
    result.opened.push(alert.key);
    console.warn(`[ops-alerts] OPENED ${alert.key}: ${alert.message}${to ? '' : ' (OPS_WHATSAPP_NUMBER unset — console only)'}`);
    await notify(row, `${alert.severity === 'critical' ? '🚨' : '⚠️'} Lukka Place — alerte\n${alert.message}`);
  }

  for (const [key, row] of open) {
    if (activeKeys.has(key)) continue;
    db.resolveOpsAlert(row.id, nowIso);
    result.resolved.push(key);
    console.log(`[ops-alerts] resolved ${key}`);
    if (row.notified_at) await notify(null, `✅ Lukka Place — résolu\n${row.message}`);
  }

  return result;
}

let lastSweepAt = 0;

const opsAlertJob = {
  name: OPS_ALERT_JOB,
  shouldRun: (now = new Date()) => now.getTime() - lastSweepAt >= CHECK_INTERVAL_MS,
  run: async () => {
    lastSweepAt = Date.now();
    return runOpsAlertSweep();
  },
};

module.exports = {
  OPS_ALERT_JOB,
  CHECK_INTERVAL_MS,
  evaluateHealth,
  runOpsAlertSweep,
  opsAlertJob,
};
