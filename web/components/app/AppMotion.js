'use client';

import { LazyMotion, MotionConfig, domMax } from 'motion/react';

/**
 * Motion for the app's screens (the `motion` package, app mode only — the
 * website keeps its CSS-only motion, web/CLAUDE.md "Motion is CSS"). Lazy
 * features with `m.*` components keep the bundle small, and only pages drawn
 * in app mode load it. `reducedMotion="user"` turns every transform off for
 * a phone set to reduce motion.
 */
export default function AppMotion({ children }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
