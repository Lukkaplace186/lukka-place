'use client';

import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import { isFavorite, subscribeFavorites, toggleFavorite } from '@/lib/favorites';
import { useIsLoggedIn } from '@/lib/customerClient';
import { useMotionSafe } from '@/lib/useMotionSafe';
import { iconPop } from '@/lib/motion';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import AuthPromptModal from './AuthPromptModal';
import { FAV_RETURN_PARAM } from './FavoriteResumeHandler';

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
 * ("Sauvegarder"/"Enregistré") for a card's bottom action row, next to
 * WhatsAppCTA, instead of floating over the photo — both variants share
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
// which is what makes iconPop's keyframe animation replay from its start
// on every tap instead of running once ever. Reduced-motion visitors get a
// plain, unanimated glyph (`safe` gates it, same convention as every other
// decorative motion preset in lib/motion.js).
function AnimatedHeart({ pulseKey, safe, ...heartProps }) {
  return (
    <motion.span
      key={pulseKey}
      className="inline-flex"
      initial={safe ? { scale: 0.6 } : false}
      animate={safe ? { scale: iconPop.scale, transition: iconPop.transition } : undefined}
    >
      <Heart {...heartProps} />
    </motion.span>
  );
}

export default function FavoriteButton({ listingId, className = '', variant = 'icon' }) {
  const pathname = usePathname();
  const loggedIn = useIsLoggedIn();
  const safe = useMotionSafe();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  // Bumped only inside handleClick (a real toggle), never on mount/hydration
  // — remounting the motion.span below on this key is what makes the pop
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

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn) {
      setShowAuthPrompt(true);
      return;
    }
    toggleFavorite(listingId);
    setPulseKey((k) => k + 1);
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
            'u-press inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.75rem] font-semibold transition-colors',
            favorited ? 'border-blue/30 bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:bg-canvas-alt',
            className,
          )}
        >
          <AnimatedHeart
            pulseKey={pulseKey}
            safe={safe}
            fill={favorited ? 'currentColor' : 'none'}
            strokeWidth={ICON_STROKE_WIDTH}
            className="h-3.5 w-3.5"
          />
          {favorited ? 'Enregistré' : 'Sauvegarder'}
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
          aria-label={favorited ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-pressed={favorited}
          className={cn(
            'u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
            favorited ? 'border-blue/30 bg-blue-tint text-blue' : 'border-line text-ink-70 hover:bg-canvas-alt',
            className,
          )}
        >
          <AnimatedHeart
            pulseKey={pulseKey}
            safe={safe}
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
        aria-label={favorited ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        aria-pressed={favorited}
        className={cn(
          // web/Design's IconButton variant="onImage": a frosted glass-white
          // circle with shadow-sm, not a flat translucent surface fill.
          // Kept at h-10/40px rather than the design's 34px — see the doc
          // comment above; that size was set from a real-device touch-target
          // measurement, and 6px of diameter doesn't change how the frosted
          // circle reads.
          'u-press u-glass-white flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition-colors hover:bg-white',
          // The one filled-glyph exception in the whole system, per the
          // design's iconography rules: the saved heart fills royal-600.
          favorited ? 'text-blue' : 'text-ink',
          className,
        )}
      >
        <AnimatedHeart
          pulseKey={pulseKey}
          safe={safe}
          fill={favorited ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-4.5 w-4.5"
        />
      </button>
      {authPrompt}
    </>
  );
}
