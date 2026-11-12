'use client';

import Link from '@/components/LocaleLink';
import { CalendarClock, Ellipsis, MessageCircle, Phone } from 'lucide-react';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const MENU_ITEM = 'flex min-h-11 cursor-pointer items-center gap-3 px-3 text-[0.9375rem] font-semibold text-ink';

/**
 * The listing's bottom bar in the app. ONE main action (UX pass 2026-11-12:
 * four equal buttons made people hesitate): "Demander une visite" is the wide
 * button on the right, under the thumb; WhatsApp is the one second button;
 * calling the agent and writing in the app wait behind "…". Same rules as the
 * website's MobileListingBar — tel: only for a verified agent's number,
 * WhatsApp through lib/leadRouting.js (Lukka Place's number first, owner
 * decision 2026-11-09), chat only where the agent has it — and the same
 * tracking. "…" is drawn only when it holds something.
 */
export default function AppListingBar({ listing }) {
  const t = useT();
  const { href, routingType } = resolveWhatsAppRouting(listing);
  const canMessage = canMessageListing(listing);
  const hasMore = Boolean(listing.agent_phone) || canMessage;
  const visitLabel = t('enquiry.requestViewing');

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto flex max-w-lg items-center gap-2">
        {hasMore ? (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t('appShell.listingBar.more')} className={ICON_BUTTON}>
              <Ellipsis strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={10} className="min-w-56 rounded-xl p-1">
              {listing.agent_phone ? (
                <DropdownMenuItem asChild>
                  <a href={telHref(listing.agent_phone)} onClick={() => trackCallClick(listing)} className={MENU_ITEM}>
                    <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-ink-70" aria-hidden="true" />
                    {t('enquiry.callAgent')}
                  </a>
                </DropdownMenuItem>
              ) : null}
              {canMessage ? (
                <DropdownMenuItem asChild>
                  <Link href={chatStartHref({ propertyId: listing.id })} className={MENU_ITEM}>
                    <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-blue" aria-hidden="true" />
                    {t('chat.cta.message')}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
        <Link
          href={`/listings/${listing.id}/visite`}
          className="u-press u-focus-ring flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-blue px-4 text-[0.9375rem] font-semibold text-white"
        >
          <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none" aria-hidden="true" />
          <span className="truncate">{visitLabel}</span>
        </Link>
      </div>
    </div>
  );
}
