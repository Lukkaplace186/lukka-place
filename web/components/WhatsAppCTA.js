import { buildWhatsAppLink, buildWhatsAppMessage } from '@/lib/whatsapp';

function WhatsAppIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.13c-.24.68-1.4 1.3-1.93 1.38-.5.08-1.12.11-1.8-.11-.42-.13-.95-.3-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.14-.19-1.17-1.56-1.17-2.98s.73-2.11 1-2.4c.26-.29.57-.36.76-.36h.55c.18 0 .42-.07.65.5.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.28.36-.23.6-.14.24.09 1.55.73 1.81.86.26.14.44.2.5.31.07.12.07.68-.17 1.35z" />
    </svg>
  );
}

/**
 * "Contact via WhatsApp" — routes to the listing's real per-listing agent
 * number (`listing.agent_phone`, via `properties.agent_id` → `agents.phone`)
 * when one is genuinely attached, otherwise Lukka Place's own central
 * WhatsApp number (CLAUDE.md's Lead Routing Rules). `agent_phone` is `null`
 * on every listing today — `resolveAgentId` (engine repo) only starts
 * matching once real agent accounts with real phone numbers exist — so in
 * practice every card still routes to the central number until then; this
 * is the graceful-fallback path, not a guess. Brand emerald (#00B050), not
 * WhatsApp's own green — a deliberate identity choice from the design spec.
 *
 * Two sizes: `variant="compact"` (default) is the small inline pill sized
 * for a horizontal card's action row (ListingCard.js). `variant="block"` is
 * the `flex-1` centre slot of a 3-button action row (Call icon / WhatsApp /
 * Save icon — ListingCardVertical.js, FeaturedListingCard.js), still the
 * visually loudest of the three (solid fill vs. the other two's outline)
 * since it's the one real conversion path this platform routes through
 * (CLAUDE.md's Lead Routing Rules), just no longer spanning the full card
 * width alone — a second round of direct user feedback (a Zoopla
 * screenshot) asked for Call and Save to sit in the same row rather than a
 * single full-width bar. `rounded-xl`, not `rounded-full`, to match the
 * square icon buttons either side of it in that row. Still real brand
 * emerald (`--green`, #00B050), not WhatsApp's own green — that identity
 * choice (see above) doesn't change just because the layout did.
 *
 * The detail page no longer uses this — it has a full EnquiryCard on
 * desktop and MobileListingBar on mobile, both of which show the price
 * alongside the CTA, so the old floating bubble variant was removed rather
 * than left as an unused branch.
 *
 * A real `<button>` navigating via `window.open`, not an `<a href target=
 * "_blank">` — every usage of this component (ListingCard.js,
 * ListingCardVertical.js, FeaturedListingCard.js) sits inside the card's
 * own outer `<Link>` (renders as `<a>`), and HTML forbids nesting `<a>`
 * inside `<a>`: the browser silently closes the outer anchor early and
 * React throws a real hydration mismatch once it notices — confirmed live
 * the moment `NEXT_PUBLIC_WHATSAPP_NUMBER` was set to a real value for
 * testing. Invisible until then only because that env var (and
 * `agent_phone`) has been empty on every listing so far (see
 * web/CLAUDE.md's Known Gaps). `window.open(href, '_blank', 'noopener,
 * noreferrer')` reproduces the same new-tab, no-opener behavior the
 * `target`/`rel` attributes gave the old `<a>`.
 *
 * @param {Object} props
 * @param {Object} props.listing
 * @param {'compact'|'block'|'link'} [props.variant]
 */
export default function WhatsAppCTA({ listing, variant = 'compact' }) {
  const phoneNumber = listing.agent_phone || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

  if (!phoneNumber) {
    // No real number is configured yet (see .env.local's TODO) — render
    // nothing rather than ship a wa.me link with an empty number.
    return null;
  }

  const message = buildWhatsAppMessage({
    reference: listing.reference,
    slug: listing.slug,
    id: listing.id,
    propertyType: listing.category_name,
    commune: listing.commune,
    price: listing.price,
    purpose: listing.purpose,
  });
  const href = buildWhatsAppLink(phoneNumber, message);

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'whatsapp_click', listingId: listing.id, commune: listing.commune }),
      keepalive: true,
    }).catch(() => {});
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  // `link` is the Rightmove-style bottom action bar's left slot: a bare
  // text+icon action on the card's own white footer strip, not a filled
  // pill. Sits beside the Save toggle under a hairline divider, so a second
  // solid green fill there would out-shout the price block two rows above
  // it — the emerald ink alone is enough to mark it as the primary action
  // in a two-item row.
  if (variant === 'link') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="u-press inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1.5 text-[0.75rem] font-bold text-green transition-colors hover:text-green-deep"
      >
        <WhatsAppIcon className="h-4 w-4" />
        WhatsApp
      </button>
    );
  }

  if (variant === 'block') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="u-press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-green px-4 text-[0.875rem] font-semibold text-white shadow-sm transition-colors hover:bg-green-deep"
      >
        <WhatsAppIcon className="h-4 w-4" />
        WhatsApp
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="u-press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green px-3.5 py-1.5 text-[0.75rem] font-semibold text-white transition-colors hover:bg-green-deep"
    >
      <WhatsAppIcon className="h-3.5 w-3.5" />
      WhatsApp
    </button>
  );
}
