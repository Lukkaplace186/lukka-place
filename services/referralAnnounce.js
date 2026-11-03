/**
 * services/referralAnnounce.js
 *
 * The referral programme announcement, sent when a verified agent writes to
 * the intake number. At that moment they are inside WhatsApp's 24 h window, so
 * the plain text lands — the one way to reach an agent the console's session
 * announcement could not, without an approved template.
 *
 * - **A side effect, never an interception.** routes/webhook.js calls
 *   `scheduleReferralAnnouncement` from its inbound loop and the message goes
 *   on to ordinary processing untouched: a listing, a code, a tap or a draft
 *   correction is handled exactly as before.
 * - **Sent a little later** (`ANNOUNCE_DELAY_MS`, 45 s), so it arrives after
 *   the reply to what the agent actually sent rather than before it.
 * - **Web decides and sends** (POST /api/internal/referral-announce, Bearer
 *   CRON_SECRET, web/lib/referralAnnouncement.js): never announced → sent; an
 *   earlier session announcement is re-sent once only when it provably could
 *   not have landed (no message from the agent in the 23 h before it). Web
 *   writes the record. The engine passes the agent's PREVIOUS message time,
 *   read before this message overwrote it.
 * - **Cheap**: only for a sender identifySender recognises as a verified agent,
 *   at most one check per number per `RECHECK_MS` (12 h) in this process, and
 *   never again once web says it is done. Never the desk or the relay SIM.
 * - `REFERRAL_ANNOUNCE_ON_WRITE=off` turns it off (read at call time).
 */

const { identifySender } = require('./agentOnboarding');

const ANNOUNCE_DELAY_MS = 45 * 1000;
const RECHECK_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const FINAL_STATUSES = new Set(['sent', 'already', 'not-eligible']);

const checkedAt = new Map();
const done = new Set();

function enabled() {
  return String(process.env.REFERRAL_ANNOUNCE_ON_WRITE || '').trim().toLowerCase() !== 'off';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function webBaseUrl() {
  return (process.env.WEB_BASE_URL || process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

/** Should this number be looked at now? Records the look. */
function dueForCheck(waId, now = Date.now()) {
  if (done.has(waId)) return false;
  const last = checkedAt.get(waId);
  if (last && now - last < RECHECK_MS) return false;
  checkedAt.set(waId, now);
  return true;
}

async function askWeb({ agentId, previousInboundAt }, fetchImpl = fetch) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${webBaseUrl()}/api/internal/referral-announce`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, previousInboundAt: previousInboundAt || null }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.status !== 'string') throw new Error(`web answered ${response.status}`);
    return body.status;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check and, when due, ask web to announce. Resolves to what happened; never throws.
 * @returns {Promise<{status: string}>}
 */
async function announceIfDue({
  from,
  previousInboundAt = null,
  identify = identifySender,
  fetchImpl = fetch,
  isExcluded = () => false,
  now = Date.now(),
}) {
  const waId = digits(from);
  if (!waId || !enabled()) return { status: 'off' };
  if (isExcluded(waId)) return { status: 'excluded' };
  if (!dueForCheck(waId, now)) return { status: 'skipped' };
  try {
    const identity = await identify(waId);
    if (!identity?.registered || !identity.agentId) return { status: 'not-an-agent' };
    const status = await askWeb({ agentId: identity.agentId, previousInboundAt }, fetchImpl);
    if (FINAL_STATUSES.has(status)) done.add(waId);
    if (status === 'sent') console.log(`[referral-announce] announcement sent to agent #${identity.agentId} as they wrote in`);
    return { status };
  } catch (err) {
    console.warn(`[referral-announce] ${waId}: ${err.message}`);
    return { status: 'failed' };
  }
}

/** Fire-and-forget from the webhook's inbound loop. */
function scheduleReferralAnnouncement(args, delayMs = ANNOUNCE_DELAY_MS) {
  const timer = setTimeout(() => {
    announceIfDue(args).catch(() => {});
  }, delayMs);
  if (typeof timer?.unref === 'function') timer.unref();
}

function resetReferralAnnounceCache() {
  checkedAt.clear();
  done.clear();
}

module.exports = {
  announceIfDue,
  scheduleReferralAnnouncement,
  resetReferralAnnounceCache,
  ANNOUNCE_DELAY_MS,
  RECHECK_MS,
};
