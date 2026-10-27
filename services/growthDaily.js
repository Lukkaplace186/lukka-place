/**
 * The launch morning run (growth plan items 15 and 22), scheduler job
 * `growth-daily`, in the Kinshasa hour GROWTH_DAILY_HOUR (default 7, before
 * the agents' digest at 8):
 *
 *  1. asks web's POST /api/cron/growth-daily, which writes the agents'
 *     referral credits (web/lib/referralCredits.js — the rules and the ledger
 *     live there, idempotent) and returns yesterday's summary text;
 *  2. sends that text to the owners' phones (ADMIN_ALERT_NUMBERS, else the
 *     desk), through the desk-alert template when one is configured
 *     (services/deskAlert.js), else as a session message.
 *
 * Like `sales-commissions` it calls web rather than reimplementing the
 * channel rules, so the dashboard and the message can never disagree.
 * GROWTH_DAILY_SUMMARY=off keeps the credit run and sends nothing.
 */

const db = require('./db');
const { sendDeskAlert } = require('./deskAlert');
const { alertRecipients } = require('./moderationAlerts');

const JOB_NAME = 'growth-daily';
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

function hourKinshasa() {
  const configured = Number.parseInt(process.env.GROWTH_DAILY_HOUR, 10);
  return Number.isFinite(configured) && configured >= 0 && configured <= 23 ? configured : 7;
}

function webBaseUrl() {
  return (process.env.WEB_BASE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

function due(now = new Date()) {
  if (now.getUTCHours() !== (hourKinshasa() + 23) % 24) return false;
  const last = db.getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= MIN_GAP_MS;
}

async function run({ fetchImpl = fetch, send = sendDeskAlert, recipients = alertRecipients } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set — the growth endpoint would reject this call');
  const response = await fetchImpl(`${webBaseUrl()}/api/cron/growth-daily`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`growth endpoint returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);

  const text = body?.summary?.text;
  let sent = 0;
  if (text && String(process.env.GROWTH_DAILY_SUMMARY || '').toLowerCase() !== 'off') {
    for (const to of recipients()) {
      try {
        await send(to, text, { previewUrl: false, label: 'growth summary' });
        sent += 1;
      } catch (err) {
        console.error(`[growth-daily] summary to …${String(to).slice(-4)} failed: ${err.message}`);
      }
    }
  }
  if (body.creditsError) throw new Error(`referral credits failed: ${body.creditsError}`);
  console.log(`[growth-daily] credits ${JSON.stringify(body.credits || {})}, summary sent to ${sent}`);
  return { credits: body.credits || null, sent };
}

const growthDailyJob = { name: JOB_NAME, shouldRun: due, run: () => run() };

module.exports = { growthDailyJob, run, due, JOB_NAME };
