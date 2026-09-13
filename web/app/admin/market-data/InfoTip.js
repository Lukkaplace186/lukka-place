'use client';

import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * A small "how is this figure computed?" explanation beside a metric. A
 * Popover rather than a hover-only title: it has to work on a phone and be
 * reachable by keyboard, and some of these explanations run to a paragraph.
 */
export default function InfoTip({ label, children }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="u-focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-35 transition-colors hover:bg-canvas-alt hover:text-ink"
        >
          <Info strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="u-micro w-80 leading-relaxed text-ink-70">
        {children}
      </PopoverContent>
    </Popover>
  );
}
