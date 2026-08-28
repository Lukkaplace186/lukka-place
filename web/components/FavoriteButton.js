'use client';

import { useSyncExternalStore } from 'react';
import { Heart } from 'lucide-react';
import { isFavorite, subscribeFavorites, toggleFavorite } from '@/lib/favorites';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * Real functionality, no accounts backend behind it: the heart toggles a
 * favorite id in the visitor's own localStorage (see lib/favorites.js) —
 * honest client-only persistence, not a fake button. Sits absolutely
 * positioned over a ListingCard's photo, which is itself a <Link>, so the
 * click must never bubble into a navigation.
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
export default function FavoriteButton({ listingId, className = '', variant = 'icon' }) {
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
    toggleFavorite(listingId);
  }

  if (variant === 'label') {
    return (
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
        <Heart
          fill={favorited ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-3.5 w-3.5"
        />
        {favorited ? 'Enregistré' : 'Sauvegarder'}
      </button>
    );
  }

  if (variant === 'bar') {
    return (
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
        <Heart
          fill={favorited ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-4 w-4"
        />
      </button>
    );
  }

  return (
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
      <Heart
        fill={favorited ? 'currentColor' : 'none'}
        strokeWidth={ICON_STROKE_WIDTH}
        className="h-4.5 w-4.5"
      />
    </button>
  );
}
