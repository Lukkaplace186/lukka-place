'use client';

import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Heart } from 'lucide-react';
import { isFavorite, subscribeFavorites, toggleFavorite } from '@/lib/favorites';
import { useIsLoggedIn } from '@/lib/customerClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { trackEvent } from '@/lib/analyticsClient';
import { cn } from '@/lib/utils';
import { FAV_RETURN_PARAM } from './FavoriteResumeHandler';
import { useT } from '@/lib/i18n/client';

// Rendered only after a guest taps a heart, so its code is fetched only then —
// this button is on every listing card sitewide.
const AuthPromptModal = dynamic(() => import('./AuthPromptModal'), { ssr: false });

/**
 * Gated behind a real account (see AuthPromptModal.js) — an explicit product
 * decision matching the same Rightmove/Zoopla pattern already applied to
 * SaveSearchButton.js's Save Search / Create Alert. A signed-in visitor is
 * unaffected: the toggle was always real and server-synced for them (see
 * lib/favorites.js's dispatch to accountFavorites.js). A guest's click no
 * longer writes to localStorage at all; it opens the auth prompt instead,
 * and the actual favorite is only added once the visitor lands back with a
 * genuine session — see FavoriteResumeHandler.js, mounted once at the site
 * layout root rather than duplicated in every instance of this button, so
 * landing back on a page with several hearts for the same listing (the
 * detail page's action row, EnquiryCard, MobileListingBar) can't toggle it
 * more than once.
 *
 * Sits absolutely positioned over a ListingCard's photo, which is itself a
 * <Link>, so the click must never bubble into a navigation.
 *
 * h-10/40px, not the original h-8/32px: measured under the ~44px touch
 * target guideline on a real phone. Callers that wrap this in their own
 * circle (EnquiryCard, MobileListingBar) size that wrapper to match — a
 * bigger visual circle around a still-32px button just adds dead padding
 * that looks tappable but isn't.
 *
 * `variant="label"` is the same real toggle rendered as a text pill
 * (t('listings.favorite.save') / t('listings.favorite.saved')) for a card's
 * bottom action row, next to WhatsAppCTA, instead of floating over the
 * photo — both variants share
 * the one localStorage-backed toggle below, nothing about the underlying
 * behaviour changes.
 *
 * `variant="bar"` is a third look: a square icon-only button (no label,
 * unlike "label") with a visible border (unlike "icon"'s translucent
 * frosted circle, built for sitting on top of a photo) — sized to match
 * CallCTA's `variant="icon"` in a 3-button action row below the image
 * (ListingCardVertical.js, FeaturedListingCard.js). Direct user feedback
 * (a Zoopla screenshot) moved Save off the photo entirely and into this
 * row, so the frosted on-photo look no longer applies here.
 */
// The heart glyph wrapped once and reused across all three variants below —
// `key={pulseKey}` remounts this span each real toggle (see handleClick),
// which is what makes the `.u-pop` keyframes (app/globals.css) replay from
// their start on every tap instead of running once ever. The first render
// (pulseKey 0) never animates, and the CSS itself is gated on
// prefers-reduced-motion.
function AnimatedHeart({ pulseKey, ...heartProps }) {
  return (
    <span key={pulseKey} className={pulseKey > 0 ? 'u-pop inline-flex' : 'inline-flex'}>
      <Heart {...heartProps} />
    </span>
  );
}

/**
 * `price`/`commune` are optional and exist only for the conversion event
 * fired below — a save with no idea what was saved is a row nobody can
 * segment. Every call site already holds the real listing row, so neither
 * is derived or guessed here; a caller that genuinely has neither sends
 * null rather than a placeholder.
 */
export default function FavoriteButton({
  listingId,
  className = '',
  variant = 'icon',
  price = null,
  commune = null,
}) {
  const t = useT();
  const pathname = usePathname();
  const loggedIn = useIsLoggedIn();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  // Bumped only inside handleClick (a real toggle), never on mount/hydration
  // — remounting the heart's span below on this key is what makes the pop
  // fire once per actual tap instead of once whenever `favorited` first
  // resolves from its SSR-false snapshot to a real localStorage value.
  const [pulseKey, setPulseKey] = useState(0);

  // useSyncExternalStore (not useEffect+useState) is the correct primitive
  // for reading an external store like localStorage: it avoids a
  // post-hydration setState flicker and gives a real server snapshot
  // (always "not favorited", since localStorage doesn't exist server-side).
  const favorited = useSyncExternalStore(
    subscribeFavorites,
    () => isFavorite(listingId),
    () => false,
  );

  /**
   * preventDefault + stopPropagation are load-bearing, not defensive noise:
   * every variant of this button renders inside something clickable — the
   * `icon` variant sits over a PropertyCard's photo, which IS a <Link> —
   * so without both, a save navigates.
   *
   * The whole body is wrapped because this is an event handler, and React
   * does NOT route a throw here to an error boundary: it becomes an
   * uncaught window error, which in a Next.js App Router page surfaces as
   * the "This page couldn't load" screen with the visitor's scroll position
   * and their save both gone. Nothing about recording a favorite is worth
   * that, so a failure here does nothing visible at all — the optimistic
   * state in lib/accountFavorites.js already reverts itself when the real
   * request fails.
   *
   * `toggleFavorite` is optimistic and returns the NEW state synchronously
   * (the network write happens in the background and reverts on failure),
   * which is what lets the event below name saved vs unsaved correctly
   * without waiting on a round trip.
   */
  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn) {
      setShowAuthPrompt(true);
      return;
    }
    try {
      const nowFavorited = toggleFavorite(listingId);
      setPulseKey((k) => k + 1);
      trackEvent(nowFavorited ? 'listing_saved' : 'listing_unsaved', {
        listingId,
        price,
        commune,
      });
    } catch (err) {
      console.error(`[favorite] toggling listing ${listingId} failed: ${err.message}`);
    }
  }

  // Read directly rather than usePathname()+useSearchParams(): this button
  // renders on every listing card sitewide, and useSearchParams() forces a
  // Suspense boundary around its caller (see web/CLAUDE.md) — introducing
  // that broadly here is exactly the anti-pattern that gotcha warns against.
  const authPromptNext = (() => {
    if (typeof window === 'undefined') return pathname;
    const params = new URLSearchParams(window.location.search);
    params.set(FAV_RETURN_PARAM, String(listingId));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  })();

  const authPrompt = showAuthPrompt ? (
    <AuthPromptModal
      open={showAuthPrompt}
      onClose={() => setShowAuthPrompt(false)}
      trigger="favorite"
      next={authPromptNext}
    />
  ) : null;

  if (variant === 'label') {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          aria-pressed={favorited}
          className={cn(
            'u-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[0.8125rem] font-semibold transition-colors',
            favorited ? 'border-blue/30 bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:bg-canvas-alt',
            className,
          )}
        >
          <AnimatedHeart
            pulseKey={pulseKey}
            fill={favorited ? 'currentColor' : 'none'}
            strokeWidth={ICON_STROKE_WIDTH}
            className="h-3.5 w-3.5"
          />
          {favorited ? t('listings.favorite.saved') : t('listings.favorite.save')}
        </button>
        {authPrompt}
      </>
    );
  }

  if (variant === 'bar') {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          aria-label={favorited ? t('listings.favorite.remove') : t('listings.favorite.add')}
          aria-pressed={favorited}
          className={cn(
            'u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
            favorited ? 'border-blue/30 bg-blue-tint text-blue' : 'border-line text-ink-70 hover:bg-canvas-alt',
            className,
          )}
        >
          <AnimatedHeart
            pulseKey={pulseKey}
            fill={favorited ? 'currentColor' : 'none'}
            strokeWidth={ICON_STROKE_WIDTH}
            className="h-4 w-4"
          />
        </button>
        {authPrompt}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={favorited ? t('listings.favorite.remove') : t('listings.favorite.add')}
        aria-pressed={favorited}
        className={cn(
          // web/Design's IconButton variant="onImage": a frosted glass-white
          // circle with shadow-sm, not a flat translucent surface fill.
          // Kept at h-10/40px rather than the design's 34px — see the doc
          // comment above; that size was set from a real-device touch-target
          // measurement, and 6px of diameter doesn't change how the frosted
          // circle reads.
          // u-hit: drawn at 40px, tapped at 44px (app/globals.css).
          'u-press u-hit relative u-glass-white flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition-colors hover:bg-white',
          // The one filled-glyph exception in the whole system, per the
          // design's iconography rules: the saved heart fills royal-600.
          favorited ? 'text-blue' : 'text-ink',
          className,
        )}
      >
        <AnimatedHeart
          pulseKey={pulseKey}
          fill={favorited ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-4.5 w-4.5"
        />
      </button>
      {authPrompt}
    </>
  );
}
