/**
 * A one-off confetti burst from a point (`.u-confetti`, app/globals.css):
 * twelve pieces on fixed angles, so server and client render the same
 * markup. Decorative only; nothing at all under reduced motion.
 */
const COLORS = ['#144FC5', '#16A34A', '#F59E0B', '#E11D48', '#0EA5E9', '#A855F7'];

export default function Confetti({ className = 'left-1/2 top-6' }) {
  return (
    <span aria-hidden="true" className={`u-confetti pointer-events-none absolute ${className}`}>
      {COLORS.flatMap((color, c) =>
        [0, 1].map((j) => {
          const i = c * 2 + j;
          return (
            <i
              key={i}
              style={{ '--confetti-angle': `${i * 30 + (j ? 12 : 0)}deg`, '--confetti-distance': `${70 + (i % 4) * 22}px`, background: color }}
            />
          );
        }),
      )}
    </span>
  );
}
