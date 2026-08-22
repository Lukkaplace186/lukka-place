'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import ListingPhotoCollage from './ListingPhotoCollage';
import FavoriteButton from './FavoriteButton';
import WhatsAppCTA from './WhatsAppCTA';
import CallCTA from './CallCTA';
import ShareButton from './ShareButton';
import AgencyLogo from './AgencyLogo';
import Price from './Price';
import { NewBadge, PhotoCountBadge, RentBadge, DepositBadge } from './ListingBadges';
import SpecItem from './SpecItem';
import {
  listingImages, isNewListing, formatAddedOn, typeLabel,
  specItems, feedLocationLine, descriptionSnippet,
} from '@/lib/listingView';

const MotionLink = motion.create(Link);

/**
 * Horizontal result card — the Rightmove-derived design, used on /favoris
 * and anywhere the full width is available for a dense, scannable row.
 *
 * The description snippet is new: pc.description used to be selected only by
 * getListingById, so feed cards structurally could not show one. It is now
 * in SELECT_FIELDS (lib/listings.js), which is what lets this card carry
 * real information rather than only a price and a title.
 *
 * Save used to float over the photo as a bare heart icon; it now sits in
 * the footer next to Call/WhatsApp/Share as a labelled pill (FavoriteButton's
 * `variant="label"`), matching the bottom action row on the other two
 * card designs. ShareButton uses its default labelled-pill look here (not
 * the square icon variant the other two cards use), matching this card's
 * own compact-pill footer aesthetic — one visual language, three layouts,
 * not one shared button style forced everywhere. `path={`/listings/${id}`}`
 * matters here too: this card lives on /favoris, not the listing's own
 * page, so ShareButton can't fall back to `window.location.href`. Call
 * (CallCTA.js) and the right-aligned agency logo (AgencyLogo.js) are both
 * real and both invisible on every listing today —
 * `properties.agent_id` only resolves once real agent accounts exist
 * (services/postgres.js's `resolveAgentId`, engine repo; see
 * WhatsAppCTA.js's doc comment) — not fabricated placeholders.
 *
 * No title line: it was 100% derivable from the category text + spec-icon
 * row already shown just below it — real content, but fully redundant.
 * AgencyLogo sits top-right next to the price row. `reference` moved
 * up next to location too (as the listing's own real code, "Réf:
 * LKP-2026-0091" — never a landmark description, see CLAUDE.md's Lead
 * Routing Rules on this exact distinction) rather than sitting duplicated
 * in the footer. No amenity feature pills ("Groupe électrogène", "Forage",
 * ...) — see ListingCardVertical.js's doc comment for the schema check
 * that ruled those out: captured by the AI per listing, never written to
 * Postgres, and amenity_contents has no real taxonomy for them anyway.
 * Garantie (DepositBadge, real deposit_months) is the one feature pill
 * backed by real data, and it already renders in the price row. This card
 * keeps `type` (category text, e.g. "Appartement") in the spec row,
 * deliberately unlike the other two cards — it has no TypeBadge chip over
 * the photo the way they do, so the spec row is the only place category
 * shows here at all.
 */
export default function ListingCard({ listing }) {
  const {
    id, title, price, purpose, reference, description,
    created_at: createdAt, deposit_months: depositMonths, price_period: pricePeriod,
    agency_logo_url: agencyLogoUrl, agency_name: agencyName,
  } = listing;

  const images = listingImages(listing);
  const specs = specItems(listing);
  const where = feedLocationLine(listing);
  const type = typeLabel(listing);
  const addedOn = formatAddedOn(createdAt);
  const snippet = descriptionSnippet(description);

  return (
    <MotionLink
      href={`/listings/${id}`}
      initial="rest"
      whileHover="hover"
      whileTap={{ scale: 0.98 }}
      animate="rest"
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-ink-25 sm:flex-row"
    >
      <div className="relative aspect-4/3 w-full shrink-0 overflow-hidden sm:aspect-auto sm:w-[19rem] lg:w-[22rem]">
        <ListingPhotoCollage images={images} alt={title} />

        <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex flex-wrap gap-1.5">
          {isNewListing(createdAt) && <NewBadge />}
        </div>
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-10">
          <PhotoCountBadge count={images.length} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p className="u-tabular text-2xl font-bold leading-none text-ink">
            <Price amount={price} purpose={purpose} pricePeriod={pricePeriod} />
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {purpose === 'rent' && <RentBadge />}
              <DepositBadge months={depositMonths} />
            </div>
            <AgencyLogo logoUrl={agencyLogoUrl} name={agencyName} />
          </div>
        </div>

        {(type || specs.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-ink-70">
            {type && <span className="font-medium capitalize text-ink">{type}</span>}
            {specs.map((s, i) => (
              <span key={s.key} className="inline-flex items-center gap-2.5">
                {(i > 0 || type) && <span aria-hidden="true" className="h-3 w-px bg-line" />}
                <SpecItem spec={s} />
              </span>
            ))}
          </div>
        )}

        {where && <p className="truncate text-[0.8125rem] font-medium text-ink-70">{where}</p>}
        {reference && <p className="u-ref -mt-1.5 text-ink-25">Réf: {reference}</p>}

        {snippet && <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-45">{snippet}</p>}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-[0.6875rem] text-ink-45">{addedOn ? `Ajouté le ${addedOn}` : null}</p>
          <div className="flex items-center gap-2">
            <FavoriteButton listingId={id} variant="label" />
            <CallCTA listing={listing} />
            <WhatsAppCTA listing={listing} />
            <ShareButton title={title} path={`/listings/${id}`} />
          </div>
        </div>
      </div>
    </MotionLink>
  );
}
