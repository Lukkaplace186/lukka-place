'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import FavoriteButton from '@/components/FavoriteButton';
import Price from '@/components/Price';
import { useLocale, useT } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';
import { cn } from '@/lib/utils';

/**
 * The listing page's own top bar in the app (2026-11-12, the owner's
 * reference apps), in place of AppTopBar — which a CSS rule hides while this
 * one is on the page (`[data-app-listing]`, app/globals.css).
 *
 * On a phone the photo runs to the top of the screen: the bar is clear and
 * holds only the back button, as a white disc on the photo (Partager and the
 * heart are the gallery's own, on the right). Once the photo has scrolled
 * away it turns white and carries the price and the place, so both stay in
 * view all the way down, with the heart beside them. From `sm` the photo is
 * not full-bleed, so the bar is the white one from the start.
 *
 * Back goes back in history when there is one, else up to the results.
 */
export default function AppListingHeader({ listing, where = null }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 230));

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(localizeHref('/listings', locale));
  }

  return (
    <header
      data-app-listing=""
      className={cn(
        'fixed inset-x-0 top-0 z-[60] flex h-16 items-center gap-2 border-b px-2.5 transition-colors duration-300 lg:hidden',
        scrolled
          ? 'border-line bg-surface'
          : 'border-line bg-surface max-sm:pointer-events-none max-sm:border-transparent max-sm:bg-transparent',
      )}
    >
      <button
        type="button"
        onClick={goBack}
        aria-label={t('appShell.back')}
        className={cn(
          'u-press pointer-events-auto flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink transition-colors duration-300 active:bg-canvas-alt',
          !scrolled && 'max-sm:bg-surface/95 max-sm:shadow-sm',
        )}
      >
        <ChevronLeft strokeWidth={2} className="h-6 w-6" aria-hidden="true" />
      </button>
      <div
        className={cn('min-w-0 flex-1 transition-opacity duration-200', !scrolled && 'max-sm:invisible max-sm:opacity-0')}
      >
        <p className="u-tabular truncate text-[1.0625rem] font-semibold leading-tight text-ink">
          <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} />
        </p>
        {where ? <p className="truncate text-[0.8125rem] leading-snug text-ink-45">{where}</p> : null}
      </div>
      <FavoriteButton
        listingId={listing.id}
        price={listing.price}
        commune={listing.commune}
        className={cn('flex-none', !scrolled && 'max-sm:invisible')}
      />
    </header>
  );
}
