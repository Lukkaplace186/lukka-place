import { analyticsDimensions } from '@/lib/requestContext';
import { clientKey, rateLimited } from '@/lib/eventIngest';

/**
 * Receives components/WebVitals.js's beacons and writes one structured log
 * line per metric: `[vitals] {"name":"LCP","value":2310,...}`.
 *
 * A log line rather than a table on purpose: this is a measurement we want
 * running today, before anyone has decided which dashboard it belongs on,
 * and it needs no migration. Read it on the VPS with
 *   pm2 logs lukka-place-web --lines 5000 --nostream | grep '\[vitals\]'
 *
 * Everything is validated and clamped — this is a public endpoint, and a log
 * line must not be a place anyone can write arbitrary text.
 */

const METRICS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
const RATINGS = new Set(['good', 'needs-improvement', 'poor']);
const NAV_TYPES = new Set(['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore']);
const NET_TYPES = new Set(['slow-2g', '2g', '3g', '4g']);
const MAX_PER_REQUEST = 10;

export function sanitizeVital(metric, device) {
  if (!metric || !METRICS.has(metric.name)) return null;
  const value = Number(metric.value);
  if (!Number.isFinite(value) || value < 0 || value > 600_000) return null;
  const route = typeof metric.route === 'string' && /^\/[\w\-/:.]{0,120}$/.test(metric.route) ? metric.route : null;
  const parts = metric.name === 'TTFB' ? sanitizeTtfbParts(metric.parts) : null;
  return {
    name: metric.name,
    value: metric.name === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value),
    rating: RATINGS.has(metric.rating) ? metric.rating : null,
    route,
    nav: NAV_TYPES.has(metric.nav) ? metric.nav : null,
    net: NET_TYPES.has(metric.net) ? metric.net : null,
    saveData: metric.saveData === true,
    device,
    // Only on a TTFB line that carries a breakdown, so every other line
    // keeps the shape the log readers already parse.
    ...(parts ? { parts } : {}),
  };
}

const PROTOCOLS = new Set(['h2', 'h3', 'http/1.1']);
const PART_KEYS = ['wait', 'dns', 'conn', 'req'];

/*
 * The first-byte breakdown from components/WebVitals.js (`ttfbParts`): four
 * durations in whole milliseconds and the protocol. Same rule as the rest of
 * this route — numbers in a sane range and values from a closed list, never
 * free text. Anything else drops the whole breakdown, not the metric.
 */
export function sanitizeTtfbParts(parts) {
  if (!parts || typeof parts !== 'object') return null;
  const clean = {};
  for (const key of PART_KEYS) {
    const value = Number(parts[key]);
    if (!Number.isFinite(value) || value < 0 || value > 600_000) return null;
    clean[key] = Math.round(value);
  }
  clean.proto = PROTOCOLS.has(parts.proto) ? parts.proto : null;
  return clean;
}

export async function POST(request) {
  if (rateLimited(`vitals:${clientKey(request)}`)) {
    return new Response(null, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const metrics = Array.isArray(body?.metrics) ? body.metrics.slice(0, MAX_PER_REQUEST) : [];
  const { device } = analyticsDimensions(request.headers, {});
  for (const metric of metrics) {
    const clean = sanitizeVital(metric, device);
    if (clean) console.log(`[vitals] ${JSON.stringify(clean)}`);
  }

  return new Response(null, { status: 204 });
}
