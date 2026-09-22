'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Folds the overview's secondary sections behind "Voir plus" below `sm`.
 * On a phone the page was ten sections long and the two that matter every
 * day — "À faire" and the four figures — were followed by a scroll through
 * banners and a chart. From `sm` up nothing changes: the content is always
 * shown and the button does not exist.
 *
 * CSS, not a media-query hook, decides the default, so the server HTML is
 * already right on both widths and there is nothing to hydrate differently.
 */
export default function AgentMoreOnPhone({ children }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="u-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-surface text-[0.8125rem] font-bold text-ink-70 sm:hidden"
      >
        {open ? t('agent.overview.showLess') : t('agent.overview.showMore')}
        <ChevronDown
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div className={`${open ? 'flex' : 'hidden'} flex-col gap-4 sm:flex sm:gap-6`}>{children}</div>
    </>
  );
}
