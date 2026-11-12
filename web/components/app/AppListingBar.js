'use client';

import Link from '@/components/LocaleLink';
import { CalendarClock, MessageCircle, Phone } from 'lucide-react';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import { telHref } from '@/lib/phone';
import { canMessageListing, chatStartHref } from '@/lib/chatRules';
import { trackCallClick, trackLeadClick } from '@/lib/analyticsClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

// Variants go through cn() (tailwind-merge): a plain string join kept both
// bg-surface and bg-green, and CSS order drew WhatsApp white on white (2026-11-12).
const ICON_BUTTON =
  'u-press u-focus-ring inline-flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-line bg-surface text-ink';

/**
 * The listing's bottom bar in the app (the app design's "Listing detail"):
 * the visit request is the one wide button and opens the app's booking
 * screen (/listings/<id>/visite); call, WhatsApp and chat are icons beside it,
 * under exactly the rules the website's MobileListingBar applies — tel: only
 * for a verified agent's number, WhatsApp through lib/leadRouting.js (Lukka
 * Place's number first, owner decision 2026-11-09), chat only where the agent
 * has it — and with the same tracking.
 */
export default function AppListingBar({ listing }) {
  const t = useT();
  const { href, routingType } = resolveWhatsAppRouting(listing);
  const canMessage = canMessageListing(listing);
  // Three icons leave ~175px at 375px: "Visiter" then, the full words otherwise.
  const iconCount = [listing.agent_phone, href, canMessage].filter(Boolean).length;
  const visitLabel = t('enquiry.requestViewing');

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto flex max-w-lg items-center gap-2">
        {listing.agent_phone ? (
          <a href={telHref(listing.agent_phone)} onClick={() => trackCallClick(listing)} aria-label={t('enquiry.callAgent')} className={ICON_BUTTON}>
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </a>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackLeadClick(listing, routingType, 'listing_app_bar')}
            aria-label={t('common.shared.whatsapp')}
            className={cn(ICON_BUTTON, 'border-transparent bg-green text-white')}
          >
            <WhatsAppIcon className="h-5 w-5" />
          </a>
        ) : null}
        {canMessage ? (
          <Link href={chatStartHref({ propertyId: listing.id })} aria-label={t('chat.cta.message')} className={cn(ICON_BUTTON, 'text-blue')}>
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </Link>
        ) : null}
        <Link
          href={`/listings/${listing.id}/visite`}
          aria-label={visitLabel}
          className="u-press u-focus-ring flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-blue px-4 text-[0.9375rem] font-semibold text-white"
        >
          <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none" aria-hidden="true" />
          <span className="truncate" aria-hidden="true">{iconCount >= 3 ? t('enquiry.visitShort') : visitLabel}</span>
        </Link>
      </div>
    </div>
  );
}
