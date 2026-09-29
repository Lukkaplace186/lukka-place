'use client';

import { MessageCircle, CalendarClock, Phone } from 'lucide-react';
import Price from './Price';
import { OPEN_VISIT_EVENT } from './EnquiryCard';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import { trackCallClick, trackLeadClick } from '@/lib/analyticsClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Sticky action bar for the detail page on mobile, replacing the floating
 * WhatsApp bubble.
 *
 * A bar keeps the price visible while the visitor scrolls a long
 * description — the bubble showed the CTA but not what it costs, so the
 * decision needed a scroll back to the top.
 *
 * Hidden from lg upward, where the sticky EnquiryCard is always in view.
 *
 * Sits at `bottom-0` now with its own `pb-[env(safe-area-inset-bottom)]`
 * (same safe-area handling BottomNav.js used to carry) — it used to sit at
 * `bottom-16` to clear that fixed tab bar underneath it, which is gone
 * entirely now (see app/(site)/layout.js), so this bar is the true bottom
 * edge of the screen on mobile and needs to account for a notch/home-
 * indicator itself.
 *
 * Routes exactly like EnquiryCard now (lib/leadRouting.js): the verified
 * agent directly, the central number otherwise. It used to go central
 * unconditionally, so the same listing offered a different contact on a
 * phone than on a laptop.
 *
 * "Visiter" sits beside WhatsApp so the tracked path (a real visit request,
 * followed up and measured) is as close to the thumb as the untracked chat.
 * It opens EnquiryCard's own dialog rather than a second form. The heart
 * made room for it: the same button is already on the photo.
 *
 * "Appeler" is an icon beside them (2026-09-29): it used to exist only in
 * EnquiryCard, well below the fold on a phone, while a call is the channel
 * landlords ask about first. Same rule as EnquiryCard's tel: link — the
 * verified agent's own number only (`agent_phone` is null otherwise, see
 * lib/listings.js), never a tel: to a number we don't have — and the same
 * tracked `call_click`.
 */
export default function MobileListingBar({ listing }) {
  const t = useT();
  const { href, routingType } = resolveWhatsAppRouting(listing);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 pb-[env(safe-area-inset-bottom)] lg:backdrop-blur-md lg:hidden"
      style={{ boxShadow: '0 -8px 24px -12px rgba(12, 29, 80, 0.25)' }}
    >
      <div className="flex items-center gap-1.5">
        {/* The amount on one unbroken line and the period under it: with the
            call icon beside Visiter and WhatsApp there is no room for
            "1 300 $ / mois" on one line at 375px, and letting it wrap split
            it after the slash or before the "$". One size down when the
            call icon is there, so a sale price in the hundreds of thousands
            still fits its column. */}
        <p className={`u-tabular min-w-0 flex-1 whitespace-nowrap font-medium leading-tight tracking-[0.1px] text-ink ${listing.agent_phone ? 'text-base' : 'text-lg'}`}>
          <Price
            amount={listing.price}
            purpose={listing.purpose}
            pricePeriod={listing.price_period}
            periodClassName="block text-[0.8125rem] font-normal tracking-normal text-ink-70"
          />
        </p>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_VISIT_EVENT, { detail: { propertyId: listing.id } }))}
          className="u-press u-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-blue"
        >
          <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('enquiry.visitShort')}
        </button>

        {listing.agent_phone ? (
          <a
            href={`tel:${listing.agent_phone}`}
            onClick={() => trackCallClick(listing)}
            aria-label={t('enquiry.callAgent')}
            className="u-press u-focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:border-blue"
          >
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </a>
        ) : null}

        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackLeadClick(listing, routingType)}
            className="u-press u-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-green px-3.5 py-2.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('common.shared.whatsapp')}
          </a>
        ) : null}
      </div>
    </div>
  );
}
