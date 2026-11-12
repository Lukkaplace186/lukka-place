'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { frenchPathOf } from '@/lib/localePaths';
import { pullDecision, pullsToRefresh, PULL_THRESHOLD } from '@/lib/appPullRules';

/**
 * Pull down to refresh, on the app's list screens (2026-11-12). A phone app
 * is expected to have it; a WebView has none of its own.
 *
 * Only a pull that starts with the page at its very top, goes clearly
 * downwards, and is not inside something that scrolls sideways (a photo
 * strip, a rail), a map or an open sheet. The page is never moved: a disc
 * comes down from the top and turns with the pull; past the threshold,
 * letting go asks the server for the page again (`router.refresh()`, which
 * keeps scroll and client state) and the disc spins until it answers.
 *
 * Listeners are passive: this can never block or slow a scroll.
 */
export default function AppPullToRefresh() {
  const router = useRouter();
  const rawPathname = usePathname() || '/';
  const pathname = frenchPathOf(rawPathname) || rawPathname;
  const enabled = pullsToRefresh(pathname);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef(null);
  const distance = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    function blocked(target) {
      if (!(target instanceof Element)) return true;
      if (document.querySelector('[role="dialog"]')) return true;
      // Anything swiped sideways, the map, a text field.
      return Boolean(target.closest('[data-card-photo], .overflow-x-auto, .gm-style, input, textarea, select'));
    }
    function onStart(e) {
      start.current = null;
      distance.current = 0;
      if (e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    function onMove(e) {
      if (!start.current) return;
      const dx = e.touches[0].clientX - start.current.x;
      const dy = e.touches[0].clientY - start.current.y;
      const next = pullDecision({ dx, dy, scrollY: window.scrollY });
      if (next === null) {
        start.current = null;
        distance.current = 0;
        setPull(0);
        return;
      }
      distance.current = next;
      setPull(next);
    }
    function onEnd() {
      const reached = distance.current >= PULL_THRESHOLD;
      start.current = null;
      distance.current = 0;
      setPull(0);
      if (!reached) return;
      setRefreshing(true);
      navigator.vibrate?.(10);
      router.refresh();
      // router.refresh() gives no signal when it lands; a short, honest spin.
      window.setTimeout(() => setRefreshing(false), 900);
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, router]);

  if (!enabled || (!pull && !refreshing)) return null;
  const shown = refreshing ? PULL_THRESHOLD : pull;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[65] flex justify-center"
      style={{ transform: `translateY(${Math.round(shown * 0.9) - 28}px)`, transition: pull ? 'none' : 'transform 200ms ease-out' }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-blue shadow-[var(--shadow-md)]">
        <RefreshCw
          strokeWidth={2}
          className={`h-5 w-5 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${Math.round(shown * 3)}deg)`, opacity: Math.min(1, shown / PULL_THRESHOLD) }}
        />
      </span>
    </div>
  );
}
