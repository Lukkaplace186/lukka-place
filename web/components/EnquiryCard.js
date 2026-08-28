'use client';

import { MessageCircle, Phone } from 'lucide-react';
import FavoriteButton from './FavoriteButton';
import ShareButton from './ShareButton';
import { getCentralWhatsAppHref, buildWhatsAppLink, buildWhatsAppMessage } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The agent panel from web/Design's listing-detail screen — the right
 * rail's first card.
 *
 * Design anatomy: an initials avatar in a royal-50 circle, the agent's name
 * and a qualifying line, a hairline divider, then a full-width primary
 * "Contacter par WhatsApp", a full-width secondary "Appeler l'agent", a
 * ghost Enregistrer/Partager pair, and a caption explaining that the
 * WhatsApp message goes out pre-filled with the reference.
 *
 * This replaces the previous version of this card, which led with the price
 * and a currency toggle. Both moved: the price now leads the main column at
 * 44px (the design's loudest number) and is restated by `PricePanel`
 * directly below this card, and the currency toggle lives in the header on
 * every page.
 *
 * Honest-data notes, unchanged from before:
 *  - `agency_name` / `agent_phone` come from the real agents join
 *    (lib/listings.js) and are NULL on every listing today, so the panel
 *    falls back to naming Lukka Place itself rather than inventing an
 *    agent. The design's "· 34 biens à Kinshasa" qualifier is dropped
 *    entirely — no per-agent listing count is available on this row, and it
 *    is exactly the kind of number that must not be guessed.
 *  - "Appeler l'agent" renders only when a real per-listing number exists.
 *  - WhatsApp falls back to the one central number, and renders a disabled
 *    state (not a dead wa.me link) when that env var is unset.
 */
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return 'LP';
  return parts.map((p) => p[0].toUpperCase()).join('');
}

export default function EnquiryCard({ listing }) {
  const {
    id, title, reference,
    agency_name: agencyName, agent_phone: agentPhone,
  } = listing;

  const message = buildWhatsAppMessage({
    reference: listing.reference,
    slug: listing.slug,
    id: listing.id,
    propertyType: listing.category_name,
    commune: listing.commune,
    price: listing.price,
    purpose: listing.purpose,
  });

  // A real per-listing agent number when one exists, otherwise Lukka
  // Place's own central number — same precedence WhatsAppCTA uses.
  const whatsappHref = agentPhone ? buildWhatsAppLink(agentPhone, message) : getCentralWhatsAppHref(message);
  const displayName = agencyName || 'Lukka Place';
  const qualifier = agencyName ? 'Agent partenaire' : 'Équipe Lukka Place';

  return (
    <div className="u-card flex flex-col gap-[1.125rem] rounded-card bg-surface p-6">
      <div className="flex items-center gap-3.5">
        <span className="u-tabular flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-full bg-blue-tint text-[1.125rem] font-extrabold text-blue-deep">
          {initialsOf(agencyName)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[0.875rem] font-bold text-ink">{displayName}</span>
          <span className="text-[0.8125rem] text-ink-45">{qualifier}</span>
        </div>
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-2.5">
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press u-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue px-5 py-3 text-sm font-semibold text-white"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            Contacter par WhatsApp
          </a>
        ) : (
          <span className="inline-flex w-full items-center justify-center rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-25">
            Contact indisponible
          </span>
        )}

        {/* Real per-listing number only — renders nothing at all rather than
            a tel: link to a number we don't have. */}
        {agentPhone ? (
          <a
            href={`tel:${agentPhone}`}
            className="u-press u-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-ink"
          >
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            Appeler l&apos;agent
          </a>
        ) : null}

        <div className="flex items-center gap-2">
          <FavoriteButton listingId={id} variant="label" className="flex-1 justify-center" />
          <ShareButton title={title} variant="icon" />
        </div>
      </div>

      {reference ? (
        <p className="text-[0.8125rem] leading-[1.45] text-ink-35">
          Le message WhatsApp part pré-rempli avec la référence{' '}
          <span className="u-ref text-ink-45">{reference}</span> et le lien de l&apos;annonce.
        </p>
      ) : null}
    </div>
  );
}
