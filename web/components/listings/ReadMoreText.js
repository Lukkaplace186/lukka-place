'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A description cut to `lines` lines with "Lire la suite" (2026-11-18, owner:
 * the story first, under the price and title, as on the reference site).
 *
 * The whole text is always in the HTML (the cut is CSS `line-clamp`), so
 * search engines and a browser without JS read all of it. The button shows
 * only when the text is really longer than the cut: a ResizeObserver compares
 * the paragraph's full height with its clamped one, so a one-line description
 * never carries a "Lire la suite" that reveals nothing. Labels come resolved
 * from the server component (no client dictionary lookup).
 */
export default function ReadMoreText({ text, moreLabel, lessLabel, lines = 4, className = '' }) {
  const id = useId();
  const ref = useRef(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // Measured only while collapsed: once open, the paragraph is its full
    // height and would always read as "not overflowing".
    const observer = new ResizeObserver(() => {
      if (!openRef.current) setOverflows(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function toggle() {
    openRef.current = !openRef.current;
    setOpen(openRef.current);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p
        ref={ref}
        id={id}
        className={className}
        style={open ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' }}
      >
        {text}
      </p>
      {overflows || open ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={id}
          className="u-press u-hit relative text-sm font-semibold text-blue-deep underline underline-offset-4"
        >
          {open ? lessLabel : moreLabel}
        </button>
      ) : null}
    </div>
  );
}
