'use client';

import { useId, useState } from 'react';

/**
 * A wrap of chips that shows only its first rows on a phone, with a button
 * to show the rest. The items arrive server-rendered as children, so every
 * link is in the HTML whether the list is open or not (a crawler follows all
 * of them; "Recherches populaires" exists for that). The caller marks the
 * items to fold with `max-sm:group-data-[collapsed]:hidden` (written in the
 * caller: a constant exported from a 'use client' file reaches a Server
 * Component as a client reference, not a string). From `sm` up everything
 * shows and the button is gone. Before hydration the list is folded, as after.
 */
export default function CollapsibleChipList({ children, hiddenCount, showAllLabel, showLessLabel, className = '' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <ul id={id} className={`group ${className}`} data-collapsed={open ? undefined : ''}>
        {children}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex min-h-11 items-center text-[0.875rem] font-semibold text-blue-deep underline-offset-4 hover:underline sm:hidden"
        >
          {open ? showLessLabel : showAllLabel}
        </button>
      ) : null}
    </>
  );
}
