import { Phone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Appeler" — a real `tel:` call to the listing's own per-listing agent
 * phone when one exists (`listing.agent_phone`, via `properties.agent_id`
 * → `agents.phone`; null on every listing today, see WhatsAppCTA.js's doc
 * comment on `resolveAgentId`), otherwise Lukka Place's own central
 * WhatsApp Business number (`NEXT_PUBLIC_WHATSAPP_NUMBER`) — a direct
 * product decision (2026-08-24): Lukka Place has no separate general phone
 * line, but a WhatsApp Business number is itself a real, registered,
 * dialable phone number, so reusing it here is not a fabrication, just a
 * second real channel to the one real number this platform already
 * publishes — same fallback shape WhatsAppCTA.js already uses for its own
 * button. Renders nothing only when *neither* is configured (see
 * WhatsAppCTA.js — `.env.local`'s `NEXT_PUBLIC_WHATSAPP_NUMBER` TODO).
 *
 * A real `<button>` navigating via `onClick`, not an `<a href="tel:...">` —
 * every usage of this component (ListingCard.js, ListingCardVertical.js,
 * FeaturedListingCard.js) sits inside the card's own outer `<Link>`
 * (renders as `<a>`), and HTML forbids nesting `<a>` inside `<a>`: the
 * browser silently closes the outer anchor early and React throws a real
 * hydration mismatch once it notices. This was invisible until now only
 * because `agent_phone` has been null on every listing so far — confirmed
 * live the moment a real number was set (see WhatsAppCTA.js's identical
 * fix and doc comment for the same bug on the WhatsApp side).
 *
 * `variant="icon"` is a square icon-only button (no "Appeler" label) sized
 * to sit in a 3-button action row next to WhatsAppCTA's `variant="block"`
 * and FavoriteButton's `variant="bar"` (FeaturedListingCard.js) — direct
 * user feedback (a Zoopla screenshot) asking for a compact left-hand call
 * button rather than a labelled pill. Default stays the labelled pill for
 * ListingCard.js's own footer.
 *
 * `variant="block"` pairs with WhatsAppCTA's own `variant="block"` as a
 * primary/secondary contact pair (Rightmove/Zillow-style "Call" + "Message"
 * buttons) — same `h-11`/`flex-1`/`rounded-xl` shape, outline instead of
 * WhatsApp's solid fill so the two read as secondary/primary rather than
 * two equally-loud actions (ListingCardVertical.js, ListingCard.js).
 *
 * @param {Object} props
 * @param {Object} props.listing
 * @param {'pill'|'icon'|'block'} [props.variant]
 */
export default function CallCTA({ listing, variant = 'pill' }) {
  const phoneNumber = listing.agent_phone || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  if (!phoneNumber) return null;

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    window.location.href = `tel:${phoneNumber}`;
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label="Appeler"
        className="u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-70 transition-colors hover:bg-canvas-alt"
      >
        <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </button>
    );
  }

  if (variant === 'block') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="u-press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[0.875rem] font-semibold text-ink-70 transition-colors hover:bg-canvas-alt"
      >
        <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        Appeler
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="u-press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[0.75rem] font-semibold text-ink-70 transition-colors hover:bg-canvas-alt"
    >
      <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      Appeler
    </button>
  );
}
