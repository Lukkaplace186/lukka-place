'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { WhatsAppIcon } from './WhatsAppCTA';
import ListingQuickShare from './ListingQuickShare';
import { warmListingCard } from '@/lib/listingCardCache';

/**
 * Mes biens' "Partager sur WhatsApp". Since 2026-10-06 it opens
 * ListingQuickShare — the branded listing card + caption, one tap to the
 * phone's share sheet — instead of a wa.me text link (product direction: the
 * card is the standard share). The text-only link is still one tap away
 * inside that dialog.
 *
 * `caption` is the formatted listing text (AgentListingsTable fetches every
 * live listing's caption in one getWhatsAppCaptionsAction call when the page
 * mounts); the dialog uses it for the text link until its own share pack
 * arrives.
 *
 * `onOpenShare`: inside the actions menu the dialog cannot live in the menu
 * item (closing the menu unmounts it), so the menu passes this and mounts
 * ListingQuickShare as its own sibling. Without it the button owns the dialog.
 *
 * Rendered only for a listing the public can see (the caller checks
 * shareBlocker).
 */
// `className`/`children` let the row menu render it as a full menu row.
export default function AgentListingWhatsAppButton({ listing, caption, className, children, onDone, onOpenShare }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  // Draw the card in the background once the button is on screen, so the
  // tap opens on a finished card (lib/listingCardCache.js decides whether the
  // connection allows it).
  useEffect(() => {
    const node = buttonRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        warmListingCard(listing);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [listing]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          onDone?.();
          if (onOpenShare) onOpenShare();
          else setOpen(true);
        }}
        aria-label={children ? undefined : `${t('agent.listings.shareWhatsApp')} — ${listing.title}`}
        title={t('agent.listings.shareWhatsApp')}
        // Icon only: a label widened the card's actions column enough to wrap
        // the price onto three lines on a 375px phone. The green glyph is the
        // most recognisable mark an agent in Kinshasa sees all day.
        className={
          className ||
          'u-press grid h-[2.125rem] w-[2.125rem] shrink-0 place-items-center rounded-lg border border-line text-green-deep transition-colors hover:bg-canvas-alt'
        }
      >
        <WhatsAppIcon className="h-[1.0625rem] w-[1.0625rem] shrink-0 text-green-deep" />
        {children}
      </button>
      {!onOpenShare && <ListingQuickShare listing={listing} caption={caption} open={open} onOpenChange={setOpen} />}
    </>
  );
}
