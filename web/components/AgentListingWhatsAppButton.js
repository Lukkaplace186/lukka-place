'use client';

import { buildWhatsAppShareLink, buildListingShareMessage } from '@/lib/whatsapp';
import { recordListingSharesAction } from '@/app/compte/agent/shareActions';
import { useT } from '@/lib/i18n/client';
import { WhatsAppIcon } from './WhatsAppCTA';

/**
 * Mes biens' one-tap "Partager sur WhatsApp", on the card itself — the
 * everyday share, pulled out of the actions menu and out of the marketing
 * dialog (2026-09-28). A plain wa.me link: WhatsApp opens on the contact
 * picker with the text already written, nothing else to choose.
 *
 * `caption` is the formatted listing text (AgentListingsTable fetches every
 * live listing's caption in one getWhatsAppCaptionsAction call when the page
 * mounts). Until it arrives, or if that read failed, the link carries the
 * short title — price — link message, so the button always works and is
 * always a real <a>: resolving the text AFTER the tap would put an await
 * before the navigation, which iPhone Safari blocks as a popup.
 *
 * Rendered only for a listing the public can see (the caller checks
 * shareBlocker); counted in listing_shares like the menu link it replaces.
 */
export default function AgentListingWhatsAppButton({ listing, caption }) {
  const t = useT();
  const text =
    caption ||
    buildListingShareMessage({
      title: listing.title,
      price: listing.price,
      purpose: listing.purpose,
      pricePeriod: listing.price_period,
      id: listing.id,
    });

  return (
    <a
      href={buildWhatsAppShareLink(text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => recordListingSharesAction({ listingIds: [listing.id], channel: 'menu_whatsapp', format: 'text' }).catch(() => {})}
      aria-label={`${t('agent.listings.shareWhatsApp')} — ${listing.title}`}
      title={t('agent.listings.shareWhatsApp')}
      className="u-press inline-flex h-[2.125rem] shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 lg:w-[2.125rem] lg:justify-center lg:px-0 text-[0.8125rem] font-bold text-ink-70 transition-colors hover:border-green-deep/40 hover:bg-canvas-alt hover:text-ink"
    >
      <WhatsAppIcon className="h-4 w-4 text-green-deep" />
      <span className="lg:hidden">{t('agent.listings.shareWhatsAppShort')}</span>
    </a>
  );
}
