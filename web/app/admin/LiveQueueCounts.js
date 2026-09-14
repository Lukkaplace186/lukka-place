'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Live work-queue counts for the whole console — one poll per browser tab,
 * shared by every badge and banner that reads it.
 *
 * Polls /admin/api/queue-counts every 30s while the tab is visible (a hidden
 * tab stops polling, and catches up the moment it is shown again). The server
 * caches the underlying counts for 15s, so fifty admins polling cost the
 * database a handful of queries a minute, not fifty.
 */

const POLL_MS = 30_000;
let snapshot = null;
const listeners = new Set();
let timer = null;
let inflight = null;

async function refresh() {
  if (inflight) return inflight;
  inflight = fetch('/admin/api/queue-counts', { cache: 'no-store', credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      if (body?.counts) {
        snapshot = body.counts;
        listeners.forEach((listener) => listener());
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function start() {
  if (timer || typeof window === 'undefined') return;
  refresh();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState === 'visible') refresh();
}

function stop() {
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
}

function subscribe(listener) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** @returns {null | Record<string, number|string|null>} */
export function useQueueCounts() {
  return useSyncExternalStore(subscribe, () => snapshot, () => null);
}

export function QueueBadge({ count }) {
  const value = Number(count) || 0;
  if (value <= 0) return null;
  return (
    <span className="u-tabular ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[0.6875rem] font-bold leading-5 text-white">
      {value > 999 ? '999+' : value}
    </span>
  );
}

/**
 * "New items" pill for a queue page: watches the given counts and, when any
 * grows past what the page was rendered with, offers a one-click refresh
 * instead of reshuffling rows under the admin's cursor.
 */
export function NewItemsNotice({ keys }) {
  const t = useT();
  const router = useRouter();
  const counts = useQueueCounts();
  const [baseline, setBaseline] = useState(null);

  const current = counts ? keys.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0) : null;
  // The first count this page sees is its baseline — adjusting state during
  // render is React's own pattern for a value derived from props.
  if (current != null && baseline == null) setBaseline(current);

  const grown = current != null && baseline != null && current > baseline;
  if (!grown) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setBaseline(current);
        router.refresh();
      }}
      className="u-press u-micro-strong fixed bottom-6 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-white shadow-lg"
    >
      <RefreshCw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      {t('admin.live.newItems')}
    </button>
  );
}
