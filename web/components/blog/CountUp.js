'use client';

import { useEffect, useRef } from 'react';

const NUMBER = /\d[\d\s  ]*(?:[.,]\d+)?/;
const DURATION = 1100;

/**
 * A key figure ("1 200 $", "38 %", "3 + 1 + 1") that counts up from zero the
 * first time it scrolls into view. Only the first number moves; the rest of
 * the text stays as written. The server renders the final text, so search
 * engines, no-JS readers, screen readers (aria-label) and reduced motion all
 * get the real figure. The frames write the span's text directly: no React
 * state, no re-render per frame.
 */
export default function CountUp({ value }) {
  const text = String(value ?? '');
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const match = text.match(NUMBER);
    if (!el || !match || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return undefined;

    const raw = match[0].trimEnd();
    const decimals = (raw.match(/[.,](\d+)$/) || [null, ''])[1].length;
    const target = Number(raw.replace(/[\s  ]/g, '').replace(',', '.'));
    if (!Number.isFinite(target)) return undefined;
    const grouped = /[\s  ]/.test(raw);
    const paint = (n) => {
      const s = n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
      el.textContent = text.replace(raw, s.replace(/ /g, ' '));
    };

    let frame = 0;
    paint(0);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / DURATION);
        if (t < 1) {
          paint(target * (1 - (1 - t) ** 3));
          frame = requestAnimationFrame(tick);
        } else {
          el.textContent = text;
        }
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      el.textContent = text;
    };
  }, [text]);

  return (
    <span aria-label={text}>
      <span ref={ref} aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
