/** Shared placeholder block for a still-loading listing card — extracted out
 * of favoris/page.js (its original, only user) so route-level loading.js
 * files can reuse the exact same shape instead of a second copy. */
export default function CardSkeleton({ className = 'h-44' }) {
  return <div className={`animate-pulse rounded-lg border border-line bg-canvas-alt ${className}`} />;
}
