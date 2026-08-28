'use client';

import { useState } from 'react';
import Link from 'next/link';
import CardImageCarousel from './CardImageCarousel';
import FavoriteButton from './FavoriteButton';
import Price from './Price';
import SpecItem from './SpecItem';
import { CardBadges, AmenityTag } from './ListingBadges';
import {
  listingImages, formatAddedOn, specItems, feedLocationLine, descriptionSnippet, matchedAmenityKeys,
} from '@/lib/listingView';
import { cn } from '@/lib/utils';

/**
 * The design system's own PropertyCard (components/property/PropertyCard.jsx
 * in web/Design/_ds), rendered against this app's real listing rows.
 *
 * This replaces the three separate card designs the app used to carry
 * (ListingCard horizontal-collage / ListingCardVertical / FeaturedListingCard).
 * web/CLAUDE.md previously justified keeping them apart — "one visual
 * language, three layouts" — but the design system ships exactly one
 * PropertyCard with a `layout` prop, so the three have been collapsed onto
 * it. That is a deliberate override of the old note, not an oversight.
 *
 * Anatomy is the design's, in its order, and is deliberately much quieter
 * than what this app had built:
 *   photo (208px tall vertical / 300px wide horizontal) — a real
 *     CardImageCarousel (swipeable, hover-revealed arrows, dot pagination),
 *     restored on top of the design's static photo per explicit instruction
 *     — scrim-image gradient, Badges top-left, saved-heart top-right, "1/N"
 *     glass-royal capsule bottom-right
 *   price + the converted-currency qualifier on one baseline row
 *   facts line   "3 ch · 2 sdb · 140 m²"
 *   address      "Avenue Colonel Ebeya, Gombe"
 *   summary      the listing's own description, clamped to two lines
 *   tags         real text-matched amenities
 *   footer       "Publiée le …" (left) and the reference code (right)
 *
 * What the design does NOT put on a card, and so is gone from here: the
 * in-card WhatsApp/Appeler CTA pair, the agency logo strip, and the
 * Save/Share button row. Those were this app's own additions. Contact now
 * happens on the listing's own page (EnquiryCard / MobileListingBar), which
 * is where the design puts it. Flagged because it is a real behaviour
 * change to the primary conversion path, made on an explicit instruction to
 * favour the design's UX over what was already working.
 *
 * Card chrome is `.u-card` + `.u-card-interactive` (globals.css): a 1px
 * inset hairline at rest that swaps for shadow-md and a 2px lift on hover,
 * per the design's card-anatomy card. Not a `border`, which is what the
 * previous cards used and what made them read as outlined boxes.
 */
export default function PropertyCard({
  listing,
  layout = 'vertical',
  isHovered = false,
  onHoverStart,
  onHoverEnd,
  className = '',
  sizes,
  priority = false,
}) {
  const {
    id, title, price, purpose, reference, description, created_at: createdAt,
    price_period: pricePeriod,
  } = listing;

  const horizontal = layout === 'horizontal';
  const images = listingImages(listing);
  const [activeIndex, setActiveIndex] = useState(0);
  const specs = specItems(listing);
  const where = feedLocationLine(listing);
  const summary = descriptionSnippet(description, 150);
  const addedOn = formatAddedOn(createdAt);
  const amenityKeys = matchedAmenityKeys(listing, 2);

  return (
    // Own `@container` so the horizontal layout's breakpoints resolve
    // against this card's own rendered width, not a caller's grid — the
    // card is dropped into panes of very different widths (/favoris full
    // bleed, the /listings results column beside a 400px map) and must
    // self-correct in each.
    <div className={cn('@container', horizontal && 'w-full')}>
    <Link
      href={`/listings/${id}`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={cn(
        'u-card u-card-interactive group flex overflow-hidden rounded-card bg-surface',
        // Horizontal only once there's room for a 300px image beside the
        // body — below that it stacks, or the text column collapses to
        // nothing in a narrow results pane.
        horizontal ? 'flex-col @[34rem]:flex-row' : 'flex-col',
        // ListingsSplitView syncs card<->map-pin hover; a synced card gets
        // the same royal ring the map pin uses rather than a second,
        // competing hover treatment.
        isHovered && 'ring-1 ring-blue',
        className,
      )}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-canvas-deep',
          horizontal
            ? 'h-[208px] w-full @[34rem]:h-auto @[34rem]:min-h-[13.75rem] @[34rem]:w-[300px]'
            : 'h-[208px] w-full',
        )}
      >
        {images.length > 0 ? (
          <CardImageCarousel
            images={images}
            alt={title}
            sizes={sizes || (horizontal ? '300px' : '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw')}
            onIndexChange={setActiveIndex}
          />
        ) : null}

        {/* --scrim-image: an ink fade from 34% down, so anything white
            sitting on the photo's lower edge survives. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--scrim-image)' }}
        />

        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          <CardBadges listing={listing} />
        </div>

        <div className="absolute right-3 top-3 z-10">
          <FavoriteButton listingId={id} />
        </div>

        {/* Short metadata over a photo uses the glass capsule, never the
            gradient — the design is explicit that the two are never
            combined on the same edge. */}
        {images.length > 1 ? (
          <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[0.8125rem] font-semibold">
            {activeIndex + 1}/{images.length}
          </span>
        ) : null}
      </div>

      <div className={cn('flex min-w-0 flex-1 flex-col gap-2', horizontal ? 'p-5' : 'p-5')}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span
            className={cn(
              'u-tabular font-bold tracking-[-0.02em] text-ink',
              horizontal ? 'text-[1.3125rem] @[34rem]:text-[1.875rem]' : 'text-[1.3125rem]',
            )}
          >
            {/* The design's `qualifier` slot is the converted-currency line
                ("≈ 520 775 000 FC"), which <Price showSubtext> already
                produces from the real, dated rate — rendered inline on the
                price's own baseline here rather than stacked below it. */}
            <Price
              amount={price}
              purpose={purpose}
              pricePeriod={pricePeriod}
              showSubtext
              subtextClassName="ml-2 text-[0.875rem] font-normal tracking-normal text-ink-45"
            />
          </span>
        </div>

        {/* Icon + tabular number + label per spec (SpecItem.js/SpecIcons.js
            — bed/bath/ruler glyphs), not a joined plain-text string. Same
            component the design's KeyFacts.js already uses on the detail
            page's fact grid; this was the one place still rendering specs
            as bare "2 ch · 1 sdb" text. */}
        {specs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-ink-45">
            {specs.map((spec) => <SpecItem key={spec.key} spec={spec} />)}
          </div>
        ) : null}

        {where ? <p className="truncate text-[0.875rem] font-medium text-ink-70">{where}</p> : null}

        {summary ? (
          <p className="line-clamp-2 text-[0.875rem] leading-[1.55] text-ink-70">{summary}</p>
        ) : null}

        {amenityKeys.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {amenityKeys.map((key) => <AmenityTag key={key} amenityKey={key} />)}
          </div>
        ) : null}

        {(addedOn || reference) ? (
          <div className="mt-auto flex items-center justify-between gap-3 pt-3">
            <span className="text-[0.8125rem] text-ink-35">{addedOn ? `Publiée le ${addedOn}` : ''}</span>
            {reference ? (
              <span className="u-tabular shrink-0 text-[0.8125rem] font-semibold text-ink-45">{reference}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
    </div>
  );
}
