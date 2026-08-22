'use client';

import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Share the current listing.
 *
 * Uses the Web Share API where the browser has one (the common case on the
 * mobile devices that dominate this market), and falls back to copying the
 * URL to the clipboard with real confirmation feedback. No social share
 * links: Lukka Place has no accounts on those networks (see Footer.js), and
 * a share button is about the visitor's own channels anyway.
 *
 * `variant="icon"` is a square icon-only button — no "Partager" label — for
 * a card's 4-button action row (ListingCardVertical.js, FeaturedListingCard.js),
 * matching CallCTA's `variant="icon"` / FavoriteButton's `variant="bar"`
 * exactly (`h-11 w-11 rounded-xl border`) so all three sit flush together.
 * Default stays the labelled pill (EnquiryCard.js, detail page).
 *
 * `path` is optional and only needed by the card usage: EnquiryCard already
 * lives ON the listing's own detail page, so `window.location.href` is
 * already the right URL to share there. A listing *card* lives on a feed
 * page (/listings, /favoris, /) — sharing `window.location.href` there
 * would share the feed URL, not the listing. Cards pass `path={`/listings/
 * ${id}`}` so the real per-listing URL gets shared instead. Built from
 * `window.location.origin` at click time (not string-concatenated from a
 * guessed host), so it's correct in any environment.
 *
 * The button sits inside a card's outer <Link> (ListingCardVertical.js /
 * FeaturedListingCard.js), so the click must stop it from also triggering
 * that Link's navigation — same guard FavoriteButton uses.
 */
export default function ShareButton({ title, path, className = '', variant = 'pill' }) {
  const [copied, setCopied] = useState(false);

  async function handleShare(e) {
    e.preventDefault();
    e.stopPropagation();
    const url = typeof window === 'undefined'
      ? ''
      : path
        ? `${window.location.origin}${path}`
        : window.location.href;
    if (!url) return;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Share sheet dismissed — fall through to copying instead.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context or denied permission). Nothing
      // useful to offer here, so stay silent rather than showing a false
      // success state.
    }
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleShare}
        aria-label={copied ? 'Lien copié' : 'Partager'}
        className={`u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
          copied ? 'border-blue/30 bg-blue-tint text-blue' : 'border-line text-ink-70 hover:bg-canvas-alt'
        } ${className}`}
      >
        {copied ? (
          <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        ) : (
          <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`u-press inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-[0.8125rem] font-semibold transition-colors ${
        copied ? 'border-blue text-blue-deep' : 'text-ink-70 hover:border-ink-25 hover:text-ink'
      } ${className}`}
    >
      {copied ? (
        <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      ) : (
        <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      )}
      {copied ? 'Lien copié' : 'Partager'}
    </button>
  );
}
