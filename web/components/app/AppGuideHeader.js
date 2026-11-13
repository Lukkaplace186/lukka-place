'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';
import { cn } from '@/lib/utils';

/**
 * The top bar of an app screen that opens on a photograph (the commune
 * guide): clear over the photo with a white back disc, then white with the
 * screen's title once the photo has scrolled away. The same behaviour as the
 * listing page's AppListingHeader, without a price. `solid` starts it white
 * (a screen with no photo to sit on).
 *
 * It carries `data-app-listing`, the marker that makes the logo bar step
 * aside (app/globals.css).
 */
export default function AppGuideHeader({ title, subtitle = null, upHref = '/', solid = false }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 190));
  const white = solid || scrolled;

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(localizeHref(upHref, locale));
  }

  return (
    <header
      data-app-listing=""
      className={cn(
        'fixed inset-x-0 top-0 z-[60] flex h-16 items-center gap-2 border-b px-2.5 transition-colors duration-300 lg:hidden',
        white ? 'border-line bg-surface' : 'pointer-events-none border-transparent bg-transparent',
      )}
    >
      <button
        type="button"
        onClick={goBack}
        aria-label={t('appShell.back')}
        className={cn(
          'u-press pointer-events-auto flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink transition-colors duration-300 active:bg-canvas-alt',
          !white && 'bg-surface/95 shadow-sm',
        )}
      >
        <ChevronLeft strokeWidth={2} className="h-6 w-6" aria-hidden="true" />
      </button>
      <div className={cn('min-w-0 flex-1 transition-opacity duration-200', !white && 'invisible opacity-0')}>
        <p className="truncate text-[1.0625rem] font-semibold leading-tight text-ink">{title}</p>
        {subtitle ? <p className="truncate text-[0.8125rem] leading-snug text-ink-45">{subtitle}</p> : null}
      </div>
    </header>
  );
}
