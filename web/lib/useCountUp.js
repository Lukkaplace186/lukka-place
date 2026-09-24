'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts to its new value instead of jumping — "Voir 26 biens"
 * rolling down to 16 as the map moves, so the change is noticed. Whole
 * numbers only; null passes straight through (nothing counted yet).
 * Reduced-motion visitors get the new value at once.
 */
export function useCountUp(value, durationMs = 380) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    let reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reduce = false;
    }
    if (value == null || from == null || from === value || reduce) {
      shownRef.current = value;
      setShown(value);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return shown;
}
