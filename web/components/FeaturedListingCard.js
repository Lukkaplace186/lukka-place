'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import CardImageCarousel from './CardImageCarousel';
import FavoriteButton from './FavoriteButton';
import WhatsAppCTA from './WhatsAppCTA';
import CallCTA from './CallCTA';
import ShareButton from './ShareButton';
import AgencyLogo from './AgencyLogo';
import Price from './Price';
import { NewBadge, TypeBadge, DepositBadge } from './ListingBadges';
import SpecItem from './SpecItem';
import { listingImages, isNewListing, formatAddedOn, typeLabel, specItems, feedLocationLine } from '@/lib/listingView';

const MotionLink = motion.create(Link);

/**
 * Homepage carousel teaser — the airiest of the three card designs.
 *
 * Zoopla-inspired redesign (2026-08-20), matching ListingCardVertical's
 * same pass: the photo stays genuinely clean (badges top-left, nothing
 * else — the previous pass's gradient/price-on-photo scrim is gone, direct
 * user feedback that it made the image feel cluttered and cut the address
 * off). Price, a bullet-separated spec line, the full address hierarchy
 * and a listing-freshness line all live in the metadata block below the
 * image now — see that file's doc comment for the full reasoning,
 * identical here. Footer is the same 4-button row (Call icon / WhatsApp
 * flex-1 / Save icon / Share icon) — Save moved off the photo entirely
 * into this row, a second round of direct feedback, so the image carries
 * only the top-left badges. ShareButton gets `path={`/listings/${id}`}`
 * for the same reason as ListingCardVertical.js: this card lives on the
 * homepage, not the listing's own page.
 *
 * Call/AgencyLogo are both real and both invisible on every listing today
 * (`agent_id` only resolves once real agent accounts exist — see
 * WhatsAppCTA.js's doc comment); WhatsAppCTA falls back to Lukka Place's
 * one central number exactly as before in the meantime.
 *
 * No title line: it was 100% derivable from the spec-icon row + TypeBadge
 * already shown, real content but fully redundant. No amenity feature
 * pills either ("Groupe électrogène", "Forage", ...) — see
 * ListingCardVertical.js's doc comment for the exact schema check that
 * ruled those out: the AI captures a free-text amenities array per
 * listing, but it never reaches Postgres, and amenity_contents has zero
 * rows beyond the 24 repurposed commune ids. Garantie (DepositBadge, real
 * deposit_months) is the one feature pill backed by real data.
 *
 * Below sm (640px) this is a snap-carousel item: `w-full min-w-full` so the
 * card exactly fills the scroller's own (already-padded) viewport — one
 * card, edge to edge, zero peek of the next one — `flex-shrink-0` so the
 * flex row never compresses it, `snap-center` so a swipe settles the
 * *whole* card in view. A previous `w-[85vw]` version deliberately left a
 * sliver of the next card showing as a "more to scroll" cue, but on real
 * devices that sliver read as a layout bug rather than a hint, so the
 * carousel now shows exactly one full card at a time. From sm up,
 * FeaturedListingsCarousel switches the parent to a real grid, and
 * `sm:w-full` is what lets this card fill its grid cell instead of
 * staying pinned to a mobile-carousel width.
 */
export default function FeaturedListingCard({ listing }) {
  const {
    id, title, price, purpose, reference, created_at: createdAt,
    deposit_months: depositMonths, price_period: pricePeriod,
    agency_logo_url: agencyLogoUrl, agency_name: agencyName,
  } = listing;

  const images = listingImages(listing);
  const specs = specItems(listing).slice(0, 3);
  const where = feedLocationLine(listing);
  const addedOn = formatAddedOn(createdAt);

  return (
    <MotionLink
      href={`/listings/${id}`}
      initial="rest"
      whileHover="hover"
      whileTap={{ scale: 0.98 }}
      animate="rest"
      className="group flex w-full min-w-full flex-shrink-0 snap-center flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-ink-25 sm:w-full sm:min-w-0"
    >
      <div className="relative aspect-4/3 w-full overflow-hidden">
        <CardImageCarousel
          images={images}
          alt={title}
          sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
        <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex flex-wrap gap-1.5">
          {isNewListing(createdAt) && <NewBadge />}
          <TypeBadge>{typeLabel(listing)}</TypeBadge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="u-tabular text-xl font-bold leading-none text-ink">
            <Price amount={price} purpose={purpose} pricePeriod={pricePeriod} />
          </p>
          <DepositBadge months={depositMonths} />
        </div>

        <div className="flex items-center justify-between gap-3">
          {specs.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium text-ink-70">
              {specs.map((s, i) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true" className="text-ink-25">&bull;</span>}
                  <SpecItem spec={s} />
                </span>
              ))}
            </p>
          ) : (
            <span />
          )}
          <AgencyLogo logoUrl={agencyLogoUrl} name={agencyName} />
        </div>

        {where && <p className="truncate text-[0.8125rem] text-ink-70">{where}</p>}
        {addedOn && <p className="text-[0.75rem] text-ink-45">Ajouté le {addedOn}</p>}
        {reference && <p className="u-ref text-ink-25">Réf: {reference}</p>}

        <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
          <CallCTA listing={listing} variant="icon" />
          <WhatsAppCTA listing={listing} variant="block" />
          <FavoriteButton listingId={id} variant="bar" />
          <ShareButton title={title} path={`/listings/${id}`} variant="icon" />
        </div>
      </div>
    </MotionLink>
  );
}
