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
import {
  PhotoCountBadge, RentBadge, DepositBadge, AmenityPill,
} from './ListingBadges';
import SpecItem from './SpecItem';
import {
  listingImages, formatAddedOn, typeLabel,
  specItems, feedLocationLine, descriptionSnippet, matchedAmenityKeys,
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
 * No title line: it was 100% derivable from the category text + spec-icon
 * row already shown just below it — real content, but fully redundant. This
 * card keeps `type` (category text, e.g. "Appartement") in that same row,
 * deliberately unlike the other two cards — it has no TypeBadge chip over
 * the photo the way they do, so the spec row is the only place category
 * shows here at all. `reference` sits on its own line (the listing's own
 * real code, "Réf: LKP-2026-0091" — never a landmark description, see
 * CLAUDE.md's Lead Routing Rules on this exact distinction).
 *
 * Rightmove/Zillow-standard pass (2026-08-24), matching
 * ListingCardVertical.js's same pass so both card designs read as one
 * contact pattern: category/specs/location now merge into one scannable
 * row (previously location sat on its own line below). Real amenity pills
 * (`AmenityPill`, `matchedAmenityKeys()`) now sit top-right of the photo —
 * still no structured amenity column exists, but the pill is a real
 * word-boundary match against this listing's own title/description, the
 * same keyword list `lib/listings.js`'s "Plus de filtres" checkboxes
 * already filter with server-side (see AmenityPill's own doc comment), not
 * an invented flag. `PhotoCountBadge` stays bottom-left, unchanged. Footer
 * is now two rows: `AgencyLogo` `variant="footer"` (avatar + name, real and
 * invisible on every listing today — `properties.agent_id` only resolves
 * once real agent accounts exist, see WhatsAppCTA.js's doc comment) with
 * "Ajouté le" / Save (`FavoriteButton` `variant="bar"`) / Share
 * (`ShareButton` `variant="icon"`) opposite it, then a full-width WhatsApp
 * (`variant="block"`, solid, primary) / Appeler (`CallCTA` `variant=
 * "block"`, outline, secondary, real per-listing number only) pair below.
 * `path={`/listings/${id}`}` on ShareButton matters here too: this card
 * lives on /favoris, not the listing's own page, so ShareButton can't fall
 * back to `window.location.href`.
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
  const amenityKeys = matchedAmenityKeys(listing);

  return (
    <MotionLink
      href={`/listings/${id}`}
      initial="rest"
      whileHover="hover"
      whileTap={{ scale: 0.98 }}
      animate="rest"
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-ink-25 sm:flex-row"
    >
      <div className="relative aspect-4/3 w-full shrink-0 overflow-hidden sm:aspect-auto sm:w-[19rem] lg:w-[22rem]">
        <ListingPhotoCollage images={images} alt={title} />

        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-10">
          <PhotoCountBadge count={images.length} />
        </div>
        {amenityKeys.length > 0 && (
          <div className="pointer-events-none absolute right-2.5 top-2.5 z-10 flex flex-wrap justify-end gap-1.5">
            {amenityKeys.map((key) => <AmenityPill key={key} amenityKey={key} />)}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p className="u-tabular text-2xl font-bold leading-none text-ink">
            <Price amount={price} purpose={purpose} pricePeriod={pricePeriod} showSubtext />
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {purpose === 'rent' && <RentBadge />}
            <DepositBadge months={depositMonths} />
          </div>
        </div>

        {/* Category, beds/baths/surface, and location on one scannable
            line — real spec items plus feedLocationLine(), matching the
            Rightmove/Zillow convention of one dense summary row rather than
            address sitting on its own line below. */}
        {(type || specs.length > 0 || where) && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-ink-70">
            {type && <span className="font-medium capitalize text-ink">{type}</span>}
            {specs.map((s, i) => (
              <span key={s.key} className="inline-flex items-center gap-2.5">
                {(i > 0 || type) && <span aria-hidden="true" className="h-3 w-px bg-line" />}
                <SpecItem spec={s} />
              </span>
            ))}
            {where && (
              <span className="inline-flex min-w-0 items-center gap-2.5">
                {(type || specs.length > 0) && <span aria-hidden="true" className="h-3 w-px bg-line" />}
                <span className="truncate font-medium">{where}</span>
              </span>
            )}
          </div>
        )}

        {reference && <p className="u-ref text-ink-25">Réf: {reference}</p>}

        {snippet && <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-45">{snippet}</p>}

        {/* Footer: agency identity (left) + Save/Share (right), then the
            primary WhatsApp / secondary Appeler contact pair full width
            below — matches ListingCardVertical.js's same two-row footer, so
            both card designs read as one consistent contact pattern. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <AgencyLogo logoUrl={agencyLogoUrl} name={agencyName} variant="footer" />
          <div className="flex shrink-0 items-center gap-2">
            <p className="text-[0.6875rem] text-ink-45">{addedOn ? `Ajouté le ${addedOn}` : null}</p>
            <FavoriteButton listingId={id} variant="bar" />
            <ShareButton title={title} path={`/listings/${id}`} variant="icon" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CallCTA listing={listing} variant="block" />
          <WhatsAppCTA listing={listing} variant="block" />
        </div>
      </div>
    </MotionLink>
  );
}
