'use client';

import { useReducedMotion } from 'framer-motion';

/**
 * Motion gate for `prefers-reduced-motion`, which nothing in this app
 * honoured before the overhaul.
 *
 * Returns `true` when it is safe to animate. Every decorative preset in
 * lib/motion.js — revealUp, imageZoom, heroDrift, the card lift — must be
 * gated through this. Functional motion (a drawer sliding in, so the user
 * can see where it came from) is exempt and is Radix's job anyway.
 *
 * Usage:
 *   const safe = useMotionSafe();
 *   <motion.div variants={safe ? revealUp : undefined} ... />
 * or for a whole preset:
 *   const reveal = useMotionSafe() ? revealUp : STATIC;
 */
export const STATIC = {
  hidden: { opacity: 1, y: 0, scale: 1 },
  visible: { opacity: 1, y: 0, scale: 1 },
  rest: { opacity: 1, y: 0, scale: 1 },
  hover: { opacity: 1, y: 0, scale: 1 },
};

export function useMotionSafe() {
  return !useReducedMotion();
}

/** Convenience: returns the preset, or a no-op variant set when reduced. */
export function useVariants(preset) {
  const safe = useMotionSafe();
  return safe ? preset : STATIC;
}
