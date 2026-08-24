'use client';

import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * A dropdown filter pill — the control the reference portals build their
 * whole search bar out of.
 *
 * Replaces native <select> elements styled to look like pills. A native
 * select cannot show a range of two inputs, cannot show a multi-field panel,
 * and renders as an OS menu that ignores the site's type and colour
 * entirely — which is most of why the old filter row read as unstyled.
 *
 * Radix Popover (not DropdownMenu) on purpose: DropdownMenu implements
 * roving focus and typeahead over menu *items*, which fights any text or
 * number input placed inside it. Popover is the correct primitive for a
 * panel that contains form controls.
 *
 * Note the panel contains no form fields of its own — FilterBar owns every
 * filter value in React state and renders hidden inputs inside the form
 * element itself. That sidesteps the portal problem entirely: Popover
 * renders to document.body, so anything nested here would fall outside the
 * <form> and never be submitted.
 *
 * Alignment is computed at open time from the trigger's real screen
 * position, not left as a static prop. Radix's Popper positioning
 * (@radix-ui/react-popper) hardcodes `shift({ crossAxis: false })` for a
 * side="bottom" content — confirmed by reading its source — meaning it
 * deliberately never slides a panel left/right to keep it on screen; the
 * only horizontal correction it offers is `flip`-ing between the fixed
 * `align="start"`/`"end"` placements, and that flip didn't reliably choose
 * the side with more room for a trigger sitting inside this component's
 * horizontally-scrollable pill row (see FilterBar.js). Confirmed against a
 * real 360px viewport: a trigger flush with the right edge still clipped
 * ~130px off-screen under plain align="start". Choosing start/end here,
 * based on which half of the viewport the trigger's center falls in,
 * guarantees the panel always opens toward the side with more room.
 */
export default function FilterPill({ label, value, active, children, align: alignProp, className = '' }) {
  const triggerRef = useRef(null);
  const [align, setAlign] = useState(alignProp || 'start');

  function handleOpenChange(open) {
    if (!open || alignProp || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    setAlign(center > window.innerWidth / 2 ? 'end' : 'start');
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger
        ref={triggerRef}
        className={`u-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-[0.8125rem] font-medium transition-colors ${
          active
            ? 'border-blue bg-blue-tint text-blue-deep'
            : 'border-line bg-surface text-ink-70 hover:border-ink-25 hover:text-ink'
        } ${className}`}
      >
        {active && value ? value : label}
        <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={8} className="w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border-line bg-surface p-4 u-lift">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Shared label styling inside a pill panel. */
export function PillFieldLabel({ children }) {
  return <span className="u-eyebrow mb-2 block">{children}</span>;
}

/** Shared option-button styling for single-choice panels. */
export function PillOption({ selected, children, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`u-press rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
        selected ? 'border-blue bg-blue text-white' : 'border-line bg-surface text-ink-70 hover:border-ink-25 hover:text-ink'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}
