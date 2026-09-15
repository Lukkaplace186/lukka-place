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
