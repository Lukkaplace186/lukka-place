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
import {
  TypeBadge, DepositBadge, PhotoCountBadge, AmenityPill, ListingStatusBadge,
} from './ListingBadges';
import SpecItem from './SpecItem';
import {
  listingImages, formatAddedOn, typeLabel, specItems, feedLocationLine, matchSnippet, matchedAmenityKeys,
} from '@/lib/listingView';
import { cn } from '@/lib/utils';

const MotionLink = motion.create(Link);

/**
 * Vertical grid card for the /listings split view — the Zillow-derived
 * design: photo with an in-card carousel and chips over the image, then a
 * dedicated metadata block closed off by a prominent WhatsApp CTA.
 *
 * Zoopla-inspired redesign (2026-08-20), a direct correction on top of the
 * previous photo-forward pass: that version put price/location on the photo
 * itself behind a gradient scrim, which real user feedback (a Zoopla
 * screenshot) called out as making the image feel cluttered and the address
 * feel cut off. This version keeps the image genuinely clean — badges
 * top-left, Save (FavoriteButton, icon variant) top-right, nothing else —
 * and moves everything else into a real metadata block below it: price +
 * Garantie pill, a bullet-separated spec line ("3 ch • 2 sdb • 120 m²",
 * matching Zoopla's own separator rather than this app's usual hairline
 * divider — deliberately different from every other divider in this
 * codebase because that's what was asked for here specifically), the full
 * address hierarchy (`feedLocationLine()` — quartier, commune, Kinshasa;
 * see that function's doc comment for why it now always ends in "Kinshasa"
 * rather than only in its address-fallback branch), and a real listing-
 * freshness line ("Ajouté le {date}", `formatAddedOn()`, both already
 * existed and needed no new data).
 *
 * `reference` ("Réf: LKP-2026-0091") stays a separate line, not folded into
 * the address hierarchy — CLAUDE.md is explicit that this is the listing's
 * own code, not a location, and conflating the two would misrepresent a
 * real field as something it isn't.
 *
 * Rightmove/Zillow-standard pass (2026-08-24): the spec line now folds in
 * `feedLocationLine()` too (beds • baths • surface • quartier/commune on one
 * scannable row, per direct request) instead of address sitting on its own
 * line below. `PhotoCountBadge` is back, top-left alongside `TypeBadge` —
 * the carousel's pagination dots still signal "swipeable", but a numeric
 * count is a distinct, faster-to-scan piece of information, not a
 * duplicate. Top-right of the photo now carries real amenity pills
 * (`AmenityPill`, `matchedAmenityKeys()` in lib/listingView.js): still no
 * structured amenity column exists (AI-captured, never written to Postgres
 * — see AmenityPill's own doc comment), but `matchedAmenityKeys` reuses the
 * exact word-boundary keyword match `lib/listings.js`'s "Plus de filtres"
 * checkboxes already filter with server-side, so a pill here is a real
 * match against this listing's own title/description, not an invented
 * flag — capped at 2 so the corner never crowds out the badges opposite it.
 *
 * Footer is now two rows, agency identity (`AgencyLogo` `variant="footer"`,
 * avatar + name, left) with Save/Share (`FavoriteButton` `variant="bar"` /
 * `ShareButton` `variant="icon"`) opposite it, then a full-width primary/
 * secondary contact pair below: WhatsApp (`WhatsAppCTA` `variant="block"`,
 * solid fill, real central-number fallback) and Appeler (`CallCTA`
 * `variant="block"`, outline, real per-listing number only — renders
 * nothing when absent, which is every listing today, see AgencyLogo.js's
 * doc comment on why `agent_id` is still null everywhere; WhatsApp's
 * `flex-1` then absorbs the freed width alone). Four buttons plus an
 * avatar+name never fit one row at this card's ~300-350px width, so the
 * previous single 4-button row split into these two rows rather than being
 * crammed together. `path={`/listings/${id}`}` on ShareButton matters
 * here: this card lives on a feed page (/listings), not the listing's own
 * page, so ShareButton can't fall back to `window.location.href` the way
 * EnquiryCard's copy does — see that component's doc comment.
 *
 * `isHovered`/`onHoverStart`/`onHoverEnd` are optional and only passed by
 * ListingsSplitView, which owns the card<->map-pin hover sync. The card
 * still goes edge-to-edge below `min-[608px]` (see ListingsSplitView's doc
 * comment on why 608, not Tailwind's `sm` 640) — that part of the previous
 * pass stands; only the image's own content changed.
 *
 * Kept distinct from ListingCard (horizontal collage) and
 * FeaturedListingCard (homepage teaser) per web/CLAUDE.md — one visual
 * language, three layouts, not one component with three modes.
 */
export default function ListingCardVertical({ listing, isHovered = false, onHoverStart, onHoverEnd, searchTerm }) {
  const {
    id, title, price, purpose, reference, description, created_at: createdAt,
    deposit_months: depositMonths, price_period: pricePeriod,
    agency_logo_url: agencyLogoUrl, agency_name: agencyName,
  } = listing;

  const images = listingImages(listing);
  const specs = specItems(listing);
  const where = feedLocationLine(listing);
  const type = typeLabel(listing);
  const addedOn = formatAddedOn(createdAt);
  const amenityKeys = matchedAmenityKeys(listing);
  // Only set when *this* listing's own description genuinely contains the
  // active free-text search term (or a real spelling variant of it) — see
  // matchSnippet's doc comment. A listing that matched the page's overall
  // search via title/address/quartier/reference/commune instead gets no
  // snippet, rather than implying a description match that isn't real.
  const snippet = matchSnippet(description, searchTerm);

  return (
    <MotionLink
      href={`/listings/${id}`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      initial="rest"
      whileHover="hover"
      whileTap={{ scale: 0.98 }}
      animate="rest"
      className={cn(
        'group flex flex-col overflow-hidden bg-surface transition-colors',
        // min-[608px], not sm (640px) — matches ListingsSplitView's own
        // breakpoint for this exact card, see that file's doc comment on
        // why 608 is the pane's real 2-column threshold, not 640.
        'border-b border-line min-[608px]:rounded-card min-[608px]:border',
        isHovered ? 'min-[608px]:border-blue' : 'min-[608px]:hover:border-ink-25',
      )}
    >
      <div className="relative aspect-4/3 w-full shrink-0 overflow-hidden">
        {/* This card only ever renders inside ListingsSplitView's @container
            grid (@[36rem]:grid-cols-2), which sizes off the pane's own
            rendered width, not the viewport — a viewport-media `sizes`
            attribute can't express that exactly, since the column count
            flips at a container width, not one of these breakpoints.
            CardImageCarousel's plain default (22rem) undershot the pane's
            real width badly (measured directly in-browser: single-column
            between 1024-1150px renders at 478-552px, ~47-48vw, while the
            22rem/38vw guesses only requested 352-389px), so next/image
            fetched a too-small source and the browser upscaled it to fill
            the box — the actual cause of the "stretched"/soft look reported
            on real devices, not a missing object-cover (every image frame
            already has one). Each tier below is set with margin above its
            measured worst case (2-col from ~640px onward measured 45-48vw
            widest, single-col at the 1024-1150px band measured up to 48vw)
            rather than an exact fit, since over-fetching a little costs
            bandwidth but under-fetching is the visible bug. */}
        <CardImageCarousel
          images={images}
          alt={title}
          sizes="(min-width: 1200px) 28vw, (min-width: 1024px) 50vw, (min-width: 640px) 60vw, 100vw"
        />

        <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex flex-wrap items-center gap-1.5">
          <TypeBadge>{type}</TypeBadge>
          <PhotoCountBadge count={images.length} />
          <ListingStatusBadge status={listing.listing_status} />
        </div>
        {amenityKeys.length > 0 && (
          <div className="pointer-events-none absolute right-2.5 top-2.5 z-10 flex flex-col items-end gap-1.5">
            {amenityKeys.map((key) => <AmenityPill key={key} amenityKey={key} />)}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="u-tabular text-xl font-bold leading-none text-ink">
            <Price amount={price} purpose={purpose} pricePeriod={pricePeriod} showSubtext />
          </p>
          <DepositBadge months={depositMonths} />
        </div>

        {/* Beds / baths / surface / location on one scannable line, per
            Rightmove/Zillow convention — the spec line and the address used
            to be two separate rows; merging them into one bullet-separated
            row (real spec items first, then feedLocationLine()) reads
            faster without losing either. */}
        {(specs.length > 0 || where) && (
          <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium text-ink-70">
            {specs.map((s, i) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="text-ink-25">&bull;</span>}
                <SpecItem spec={s} />
              </span>
            ))}
            {where && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {specs.length > 0 && <span aria-hidden="true" className="text-ink-25">&bull;</span>}
                <span className="truncate">{where}</span>
              </span>
            )}
          </p>
        )}

        {addedOn && <p className="text-[0.75rem] text-ink-45">Ajouté le {addedOn}</p>}
        {reference && <p className="u-ref text-ink-25">Réf: {reference}</p>}
        {snippet ? (
          <p className="line-clamp-2 text-[0.75rem] italic leading-snug text-ink-45">
            {snippet.before}
            <mark className="rounded-sm bg-blue-tint px-0.5 not-italic text-blue-deep">{snippet.match}</mark>
            {snippet.after}
          </p>
        ) : null}

        {/* Footer: agency identity (left) + Save/Share (right) on one row,
            then the primary WhatsApp / secondary Appeler contact pair full
            width below — four buttons plus an avatar+name never fit one row
            at this card's ~300-350px width, and a full-width contact pair
            reads as more confidently "primary action" than four buttons of
            equal size crammed together. */}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-3">
          <AgencyLogo logoUrl={agencyLogoUrl} name={agencyName} variant="footer" />
          <div className="flex shrink-0 items-center gap-1.5">
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
