'use client';

import { m } from 'motion/react';

/**
 * Two or three tabs in one grey track (the app design's Homes / Searches).
 * The white pill slides under the chosen one (shared layoutId per `id`).
 * Real tabs: role="tablist", arrow keys move between them.
 */
export default function AppSegmented({ id, options, value, onChange, label }) {
  function onKeyDown(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    onChange(next.value);
    event.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex rounded-xl bg-canvas-alt p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            data-value={option.value}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`relative h-10 flex-1 rounded-lg text-[0.9375rem] font-semibold transition-colors ${selected ? 'text-ink' : 'text-ink-45'}`}
          >
            {selected ? (
              <m.span
                layoutId={`segmented-${id}`}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
