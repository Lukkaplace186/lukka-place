'use client';

import { MessageCircle } from 'lucide-react';
import Price from './Price';
import FavoriteButton from './FavoriteButton';
import { getCentralWhatsAppHref, buildWhatsAppMessage } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Sticky action bar for the detail page on mobile, replacing the floating
 * WhatsApp bubble.
 *
 * A bar keeps the price visible while the visitor scrolls a long
 * description — the bubble showed the CTA but not what it costs, so the
 * decision needed a scroll back to the top.
 *
 * Sits at bottom-16 to clear BottomNav, and is hidden from lg upward where
 * the sticky EnquiryCard is always in view.
 */
export default function MobileListingBar({ listing }) {
  const href = getCentralWhatsAppHref(
    buildWhatsAppMessage({
      reference: listing.reference,
      slug: listing.slug,
      id: listing.id,
      propertyType: listing.category_name,
      commune: listing.commune,
      price: listing.price,
      purpose: listing.purpose,
    }),
  );

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md lg:hidden"
      style={{ boxShadow: '0 -8px 24px -12px rgba(12, 29, 80, 0.25)' }}
    >
      <div className="flex items-center gap-3">
        <p className="u-tabular min-w-0 flex-1 text-lg font-bold leading-none text-ink">
          <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} />
        </p>

        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line transition-colors hover:border-blue">
          <FavoriteButton listingId={listing.id} className="bg-transparent" />
        </span>

        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press u-focus-ring inline-flex shrink-0 items-center gap-2 rounded-full border border-transparent bg-green px-5 py-2.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}
