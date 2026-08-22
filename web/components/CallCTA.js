import { Phone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Appeler" — a real `tel:` link using the listing's own per-listing agent
 * phone (`listing.agent_phone`, via `properties.agent_id` → `agents.phone`).
 * Renders nothing when absent, which is every listing today (see
 * WhatsAppCTA.js's doc comment on `resolveAgentId`) — Lukka Place has no
 * general phone line, only WhatsApp (CLAUDE.md), so unlike WhatsAppCTA
 * there is no honest central-number fallback to offer here. No agent
 * phone means no Call button, not a substitute number.
 *
 * `variant="icon"` is a square icon-only button (no "Appeler" label) sized
 * to sit in a 3-button action row next to WhatsAppCTA's `variant="block"`
 * and FavoriteButton's `variant="bar"` (ListingCardVertical.js,
 * FeaturedListingCard.js) — direct user feedback (a Zoopla screenshot)
 * asking for a compact left-hand call button rather than a labelled pill.
 * Default stays the labelled pill for ListingCard.js's own footer.
 *
 * @param {Object} props
 * @param {Object} props.listing
 * @param {'pill'|'icon'} [props.variant]
 */
export default function CallCTA({ listing, variant = 'pill' }) {
  const phoneNumber = listing.agent_phone;
  if (!phoneNumber) return null;

  if (variant === 'icon') {
    return (
      <a
        href={`tel:${phoneNumber}`}
        onClick={(e) => e.stopPropagation()}
        aria-label="Appeler"
        className="u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-70 transition-colors hover:bg-canvas-alt"
      >
        <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </a>
    );
  }

  return (
    <a
      href={`tel:${phoneNumber}`}
      onClick={(e) => e.stopPropagation()}
      className="u-press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[0.75rem] font-semibold text-ink-70 transition-colors hover:bg-canvas-alt"
    >
      <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      Appeler
    </a>
  );
}
