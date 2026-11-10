'use client';

import { useEffect, useRef } from 'react';

/**
 * Plays a block's entrance (fade and rise, bars growing, lines drawing —
 * the CSS is `[data-reveal]` in app/globals.css) when it scrolls into view.
 *
 * The server renders the block fully visible. Only once this runs, and only
 * for a block still below the fold, is it "armed" (hidden, ready to play):
 * without JavaScript, for a block already on screen, or under reduced motion
 * (the CSS ignores the attribute there), the reader simply sees it.
 */
export default function Reveal({ children, className = '', as: Tag = 'div' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return undefined;
    el.dataset.reveal = 'armed';
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = 'shown';
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <Tag ref={ref} data-reveal="" className={className}>
      {children}
    </Tag>
  );
}
