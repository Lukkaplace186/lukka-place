import { clientIpFromHeaders } from './clientIp';
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

/**
 * A customer reaching an agent — a WhatsApp tap or an "Appeler" tap — has its
 * own budget per IP (2026-11-21, owner). On the shared one, page views,
 * searches and the ad pixel's server copies from every phone behind one
 * Kinshasa carrier IP could use up the 60 a minute during a campaign, and the
 * rare tap that matters most was refused with a 429 nobody saw. Taps are a few
 * a minute at most, even shared; 30 still stops a loop.
 */
export const CONTACT_MAX_EVENTS = 30;

const SWEEP_EVERY_MS = 1_000;
const hits = new Map();
let lastSweep = 0;

/*
 * Refusals are logged, never silent (2026-11-21): one line a minute at most,
 * per budget, with how many were refused and from how many addresses (each
 * address shortened to its network — an IP is not kept whole in the log).
 */
const REFUSAL_LOG_EVERY_MS = 60_000;
const refused = new Map();
let lastRefusalLog = Date.now();

/** The budget a key belongs to: its prefix ('contact', 'vitals', …) or 'shared'. */
export function budgetOf(key) {
  const text = String(key || '');
  const colon = text.indexOf(':');
  // An IPv6 address has colons too ("abcd:…"); a budget prefix is letters
  // with at least one that is not a hex digit (contact, vitals, onboarding…).
  const prefix = text.slice(0, colon);
  return colon > 0 && /^[a-z-]+$/.test(prefix) && /[g-z-]/.test(prefix) ? prefix : 'shared';
}

/** 41.243.x.x / 2c0f:f248:… — enough to see a carrier, never one person's address. */
export function maskIp(key) {
  const text = String(key || '');
  const ip = budgetOf(text) === 'shared' ? text : text.slice(text.indexOf(':') + 1);
  const v4 = ip.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:…`;
  return ip ? 'other' : 'unknown';
}

function noteRefusal(key, now) {
  const budget = budgetOf(key);
  const entry = refused.get(budget) || { count: 0, networks: new Map() };
  entry.count += 1;
  const net = maskIp(key);
  entry.networks.set(net, (entry.networks.get(net) || 0) + 1);
  refused.set(budget, entry);
  if (now - lastRefusalLog >= REFUSAL_LOG_EVERY_MS) flushRefusals(now);
}

/** Writes the refusals counted since the last line; exported for the tests. */
export function flushRefusals(now = Date.now()) {
  const seconds = Math.round((now - lastRefusalLog) / 1000);
  lastRefusalLog = now;
  const lines = [];
  for (const [budget, entry] of refused) {
    const top = [...entry.networks].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}×${c}`).join(', ');
    lines.push(`[rate-limit] refused ${entry.count} event(s) in ${seconds}s on the ${budget} budget — ${entry.networks.size} network(s): ${top}`);
  }
  refused.clear();
  for (const line of lines) console.warn(line);
  return lines;
}

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
    noteRefusal(key, now);
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

/** The visitor's address behind Traefik and Cloudflare (lib/clientIp.js). */
export function clientKey(request) {
  return clientIpFromHeaders(request.headers) || 'unknown';
}

/** The contact budget's key: WhatsApp and "Appeler" taps (CONTACT_MAX_EVENTS). */
export function contactKey(request) {
  return `contact:${clientKey(request)}`;
}

/** /api/track events that are a customer reaching an agent, on the contact budget. */
export const CONTACT_EVENT_TYPES = Object.freeze(['call_click', 'whatsapp_click']);
