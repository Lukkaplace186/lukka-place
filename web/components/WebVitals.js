'use client';

import { useEffect } from 'react';
import { useReportWebVitals } from 'next/web-vitals';

/**
 * Real-user Core Web Vitals, from the phones our visitors actually use.
 *
 * Lab numbers from a laptop say nothing about a Tecno on a Kinshasa 3G cell,
 * and until this existed nobody had field data at all. Each metric is queued
 * and sent in one beacon when the page is hidden (or every 10 metrics), to
 * POST /api/telemetry/vitals, which writes one `[vitals] {json}` line per
 * metric to the web process log — no database, no third party, no cookie.
 *
 * What is sent is deliberately coarse: the metric, its value and rating, the
 * route with numeric ids collapsed ("/listings/:id"), the navigation type,
 * and the browser's own connection class and Data Saver flag. No query
 * string, no user id.
 */

const ENDPOINT = '/api/telemetry/vitals';
const REPORTED = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
const FLUSH_AT = 10;
let queue = [];

export function routeTemplate(pathname) {
  const path = String(pathname || '/').split('?')[0];
  return path.split('/').map((segment) => (/^\d+$/.test(segment) ? ':id' : segment)).join('/') || '/';
}

/*
 * Where a first byte's wait went (2026-11-19). The home page's TTFB doubled
 * to ~2.1 s the day ads started landing on it while the server answers in
 * 50 ms, and one number cannot say whether that is a redirect before our
 * URL, the DNS lookup, the TCP + TLS handshake or the trip to Paris and back.
 * From the navigation entry web-vitals already hands us:
 *   wait  — before the request for this URL starts (redirects, the in-app
 *           browser opening); a cross-origin redirect is only visible here
 *   dns   — name lookup
 *   conn  — TCP + TLS
 *   req   — request sent → first byte (edge + origin)
 *   proto — h2 / h3
 * Null when the browser gives no entry.
 */
export function ttfbParts(entry) {
  if (!entry || typeof entry.responseStart !== 'number') return null;
  const span = (from, to) => Math.max(0, Math.round((Number(to) || 0) - (Number(from) || 0)));
  return {
    wait: span(0, entry.workerStart || entry.fetchStart),
    dns: span(entry.domainLookupStart, entry.domainLookupEnd),
    conn: span(entry.connectStart, entry.connectEnd),
    req: span(entry.requestStart, entry.responseStart),
    proto: typeof entry.nextHopProtocol === 'string' ? entry.nextHopProtocol : null,
  };
}

function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ metrics: queue });
  queue = [];
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    // Telemetry must never surface an error to a visitor.
  }
}

// Module-level so its identity is stable: useReportWebVitals re-subscribes
// when the callback changes.
function report(metric) {
  if (!REPORTED.has(metric.name)) return;
  const connection = navigator.connection;
  queue.push({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    nav: metric.navigationType,
    route: routeTemplate(window.location.pathname),
    net: connection?.effectiveType || null,
    saveData: Boolean(connection?.saveData),
    ...(metric.name === 'TTFB' ? { parts: ttfbParts(metric.entries?.[0]) } : {}),
  });
  if (queue.length >= FLUSH_AT) flush();
}

export default function WebVitals() {
  useReportWebVitals(report);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  return null;
}
