'use client';

import { LazyMotion, MotionConfig } from 'motion/react';

// The animation features (`domMax`: animations, gestures, drag, shared
// layout) arrive in their own chunk after hydration instead of in the shared
// bundle. Measured on lukkaplace.com 2026-11-15: loaded eagerly they were
// ~55-60 KB brotli of the ~354 KB on every app-mode page. Safe because every
// entrance here moves (y/x) and never starts at opacity 0, so the server HTML
// is complete before the features land; an animation simply starts a beat
// later. Same pattern as components/blog/guideCardFeatures.js.
const loadFeatures = () => import('./appMotionFeatures').then((mod) => mod.default);

/**
 * Motion for the app's screens (the `motion` package, app mode only — the
 * website keeps its CSS-only motion, web/CLAUDE.md "Motion is CSS"). Lazy
 * features with `m.*` components keep the bundle small, and only pages drawn
 * in app mode load it. `reducedMotion="user"` turns every transform off for
 * a phone set to reduce motion.
 */
export default function AppMotion({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
