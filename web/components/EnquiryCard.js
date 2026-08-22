'use client';

import { MessageCircle } from 'lucide-react';
import Price from './Price';
import CurrencyToggle from './CurrencyToggle';
import FavoriteButton from './FavoriteButton';
import ShareButton from './ShareButton';
import { RentBadge, DepositBadge } from './ListingBadges';
import { specItems, locationLine, formatAddedOn } from '@/lib/listingView';
import { buildWhatsAppLink, buildWhatsAppMessage } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Sticky enquiry panel — the conversion surface of the detail page.
 *
 * There is no agent identity anywhere in the schema: no name, photo, phone
 * or email. The reference portals fill this exact slot with an agent card,
 * and inventing one is precisely what CLAUDE.md's no-fabricated-data rule
 * forbids. So this panel leads with the facts we can actually stand behind —
 * price, currency, reference code, publication date — and routes to the one
 * real central WhatsApp number.
 *
 * When NEXT_PUBLIC_WHATSAPP_NUMBER is unset the CTA renders as an honest
 * disabled state rather than a wa.me link with an empty number.
 */
export default function EnquiryCard({ listing }) {
  const { id, title, price, purpose, reference, created_at: createdAt, deposit_months: depositMonths, price_period: pricePeriod } = listing;

  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const href = phoneNumber
    ? buildWhatsAppLink(
        phoneNumber,
        buildWhatsAppMessage({
          reference: listing.reference,
          slug: listing.slug,
          id: listing.id,
          propertyType: listing.category_name,
          commune: listing.commune,
          price: listing.price,
          purpose: listing.purpose,
        }),
      )
    : null;

  const where = locationLine(listing);
  const specs = specItems(listing).slice(0, 3);
  const addedOn = formatAddedOn(createdAt);

  return (
    <div className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {where ? <p className="u-eyebrow mb-2">{where}</p> : null}
          <p className="u-tabular text-[1.75rem] font-bold leading-none text-ink">
            <Price amount={price} purpose={purpose} pricePeriod={pricePeriod} />
          </p>
        </div>
        <CurrencyToggle />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {purpose === 'rent' ? <RentBadge /> : null}
        <DepositBadge months={depositMonths} />
      </div>

      {specs.length > 0 ? (
        <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
          {specs.map((s) => (
            <div key={s.key} className="bg-canvas px-2 py-3 text-center">
              <p className="u-tabular text-base font-bold text-ink">{s.value}</p>
              <p className="mt-0.5 text-[0.6875rem] text-ink-45">{s.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex items-center justify-center gap-2 rounded-full bg-green px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-deep"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            Contacter via WhatsApp
          </a>
        ) : (
          <span className="inline-flex items-center justify-center rounded-full border border-line px-6 py-3.5 text-sm font-semibold text-ink-25">
            Contact indisponible
          </span>
        )}

        <div className="flex items-center gap-2">
          <ShareButton title={title} className="flex-1" />
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line">
            <FavoriteButton listingId={id} className="bg-transparent" />
          </span>
        </div>
      </div>

      {(reference || addedOn) ? (
        <div className="mt-5 border-t border-line pt-4 text-[0.75rem] text-ink-45">
          {reference ? (
            <p className="flex items-center justify-between gap-3">
              <span>Référence</span>
              <span className="u-ref text-ink-70">{reference}</span>
            </p>
          ) : null}
          {addedOn ? (
            <p className="mt-1.5 flex items-center justify-between gap-3">
              <span>Publié le</span>
              <span className="text-ink-70">{addedOn}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
