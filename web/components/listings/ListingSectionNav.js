'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Phone-only section strip on /listings/[id] (2026-10-06 storefront
 * upgrade): Aperçu · Coûts · Caractéristiques · Emplacement, sticky under the
 * fixed header. The page is long on a phone (facts, entry costs, agent,
 * description, map, similar listings) and had no way to jump; desktop keeps
 * the docked rail and needs none.
 *
 * `sections` is [{ id, label }] for the sections that actually render on
 * this listing — the page drops "Coûts" when the listing states no itemised
 * entry costs, so a tab never jumps to nothing. The active tab follows the
 * scroll (IntersectionObserver, no scroll listener); a tap scrolls to the
 * section, whose own `scroll-mt-*` clears the header and this strip.
 */
export default function ListingSectionNav({ sections = [], label }) {
  const [active, setActive] = useState(sections[0]?.id || null);
  const lockUntil = useRef(0);
  const ids = sections.map((s) => s.id).join(',');

  useEffect(() => {
    const nodes = ids.split(',').map((id) => document.getElementById(id)).filter(Boolean);
    if (!nodes.length || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < lockUntil.current) return;
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // A section is "current" while it crosses the band just under the
      // header + this strip.
      { rootMargin: '-120px 0px -55% 0px' },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids]);

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label={label}
      className="no-scrollbar sticky top-16 z-30 -mx-4 flex gap-1 overflow-x-auto border-b border-line bg-canvas/95 px-3 py-1.5 backdrop-blur-sm lg:hidden"
    >
      {sections.map(({ id, label: text }) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={active === id ? 'true' : undefined}
          onClick={(event) => {
            const target = document.getElementById(id);
            if (!target) return;
            event.preventDefault();
            setActive(id);
            // Hold the tab the visitor picked while the smooth scroll passes
            // the sections in between.
            lockUntil.current = Date.now() + 900;
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          }}
          className={cn(
            'inline-flex min-h-10 shrink-0 items-center rounded-full px-3.5 text-[0.84375rem] font-bold transition-colors',
            active === id ? 'bg-ink text-white' : 'text-ink-45',
          )}
        >
          {text}
        </a>
      ))}
    </nav>
  );
}
