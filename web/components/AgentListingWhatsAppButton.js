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
// `className`/`children` let the row menu render it as a full menu row
// (2026-09-28: the icon left the card, the menu holds it now).
export default function AgentListingWhatsAppButton({ listing, caption, className, children, onDone }) {
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
      onClick={() => {
        recordListingSharesAction({ listingIds: [listing.id], channel: 'menu_whatsapp', format: 'text' }).catch(() => {});
        onDone?.();
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
    </a>
  );
}
