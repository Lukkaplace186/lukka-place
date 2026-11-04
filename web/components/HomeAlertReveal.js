'use client';

import { useId, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The alert band's one bit of state: the commune + budget picker stays
 * folded until "Créer une alerte" is tapped (HomeAlertBand.js). The picker
 * is rendered from the start and only hidden, so its own state survives a
 * close and reopen, and opening costs no request.
 */
export default function HomeAlertReveal({ intro, secondary, openLabel, closeLabel, children }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
        {intro}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap lg:shrink-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="u-press inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-[0.9375rem] font-semibold text-blue-deep transition-colors hover:bg-blue-tint"
          >
            {open
              ? <X strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4" />
              : <BellRing strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4" />}
            {open ? closeLabel : openLabel}
          </button>
          {secondary}
        </div>
      </div>
      <div id={panelId} hidden={!open} className="mt-6 rounded-2xl bg-surface p-5 text-ink sm:p-6 lg:max-w-3xl">
        {children}
      </div>
    </>
  );
}
