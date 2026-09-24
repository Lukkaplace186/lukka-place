/**
 * Saving a listing sends a small heart from the button to the header's
 * account icon — where saved listings live ("Mes favoris" is in that menu) —
 * and the icon gives a little pulse as it lands. It teaches the way back to
 * the listing without a word of copy.
 *
 * Web Animations API on a throwaway fixed element: no layout of the page is
 * touched, and nothing is left behind. Skipped for reduced motion, and when
 * the account icon is not on screen.
 */

const HEART_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2 0 3.5 1.1 4.1 2.3.6-1.2 2.1-2.3 4.1-2.3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>';

export function flyHeartToAccount(fromEl) {
  if (typeof window === 'undefined' || !fromEl) return;
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch {
    return;
  }
  const target = document.querySelector('[data-fly-target="account"]');
  if (!target || typeof target.animate !== 'function') return;
  const to = target.getBoundingClientRect();
  if (!to.width || to.bottom < 0 || to.top > window.innerHeight) return;
  const from = fromEl.getBoundingClientRect();

  const heart = document.createElement('div');
  heart.innerHTML = HEART_SVG;
  Object.assign(heart.style, {
    position: 'fixed',
    left: `${from.left + from.width / 2 - 11}px`,
    top: `${from.top + from.height / 2 - 11}px`,
    width: '22px',
    height: '22px',
    color: '#1e3aa8',
    zIndex: '1000',
    pointerEvents: 'none',
  });
  document.body.appendChild(heart);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const flight = heart.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      // An arc: up and over, not a straight line across the page.
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(1.25)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.35 },
    ],
    { duration: 720, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
  );
  const done = () => {
    heart.remove();
    target.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 320, easing: 'ease-out' },
    );
  };
  flight.onfinish = done;
  flight.oncancel = () => heart.remove();
}
