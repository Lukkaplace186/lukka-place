/**
 * The shared guard rails for the unauthenticated event endpoints —
 * app/api/track and app/api/telemetry/lead-click.
 *
 * One module, one in-process budget per IP across both, so a second endpoint
 * does not quietly double what a loop can write. The limiter is best-effort:
 * the app runs as a single PM2 fork (see web/CLAUDE.md), so one process sees
 * all traffic. A speed bump against casual abuse, not a defence against a
 * determined distributed one. See app/api/track/route.js for the full note.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 60;
/**
 * Endpoints a real customer calls many times a minute, behind an IP that
 * Kinshasa's mobile operators share between many customers (carrier-grade
 * NAT): the "Mon déménagement" live results and the card drop-off beacon.
 * 60 a minute per IP would refuse ordinary customers during a campaign
 * (2026-11-07); this still stops a loop.
 */
export const SHARED_IP_MAX_EVENTS = 600;
const SWEEP_EVERY_MS = 1_000;
const hits = new Map();
let lastSweep = 0;

export function rateLimited(key, max = RATE_LIMIT_MAX_EVENTS) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  // Sweep on write rather than on a timer (a timer would keep this module
  // alive), but at most once a second: with higher limits, re-filtering
  // every stored timestamp on every request would itself cost CPU in a rush.
  if (now - lastSweep >= SWEEP_EVERY_MS) {
    lastSweep = now;
    for (const [k, timestamps] of hits) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }

  const recent = (hits.get(key) || []).filter((t) => t > cutoff);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

/**
 * A price worth storing, or NULL. Anything that is not a real positive finite
 * number becomes NULL — a 0 would assert a free property rather than an
 * unknown one. Same distinction lib/listingView.js's `hasArea` draws.
 */
export function usableAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Behind Traefik, the socket address is the proxy — the real client is in the forwarded header. */
export function clientKey(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}
