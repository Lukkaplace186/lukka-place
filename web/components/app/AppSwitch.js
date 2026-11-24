'use client';

import { m } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * An on/off switch (the app design's "Instant alerts" toggle). A real
 * role="switch" button; the knob springs across, which is the one thing that
 * shows the tap took. `busy` keeps it from being flipped twice mid-save.
 */
export default function AppSwitch({ checked, onChange, label, busy = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-[3.25rem] flex-none items-center rounded-full p-1 transition-colors duration-200 disabled:opacity-60',
        checked ? 'justify-end bg-blue' : 'justify-start bg-line',
      )}
    >
      <m.span layout transition={{ type: 'spring', stiffness: 700, damping: 40 }} className="h-6 w-6 rounded-full bg-white shadow-sm" />
    </button>
  );
}
