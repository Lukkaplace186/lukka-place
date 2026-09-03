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
 *   photo (16:9 full-width vertical / 300px wide once horizontal flips to
 *     a real row — see the image container's own comment) — a real
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
 * Card chrome used to be `.u-card` + `.u-card-interactive` (globals.css): a
 * 1px inset hairline at rest that swaps for shadow-md and a 2px lift on
 * hover, per the design's card-anatomy card, deliberately not a `border` —
 * which is what the previous cards used and what made them read as
 * outlined boxes. That's now reversed on an explicit "bold, high-contrast,
 * Zoopla/Zillow-style elevation" instruction: a real `border-line` border
 * plus a genuine shadow at rest (not just on hover), lifting further on
 * hover. Written as plain utilities rather than through
 * `.u-card`/`.u-card-interactive` so the shadow doesn't have to out-cascade
 * that class's own `box-shadow: var(--hairline)` rule at matching
 * specificity, which is a fragile thing to rely on.
 *
 * The shadow itself is a bespoke arbitrary value, not Tailwind's stock
 * `shadow-sm`/`shadow-md` (those resolve to Tailwind's own un-themed scale
 * here — `--shadow-md` in globals.css is a real design token but isn't
 * registered under `@theme`, so the plain utility name never picked it up)
 * and noticeably stronger than the site's own `--shadow-md` token, on an
 * explicit "make the listings pop like Rightmove's cards" instruction —
 * Rightmove's own card shadow reads as a clear, deliberate lift off the
 * white page, not a faint hairline-adjacent tint.
 *
 * Grid-row height uniformity: the summary line and the amenity-tag row
 * both reserve their own space (`min-h-*`) whether or not a given listing
 * has that content, and the visible card box carries `h-full` — see the
 * inline comments at each — so "Publiée le …" lands at the same y-position
 * on every card in a row instead of drifting up or down with how much text
 * a listing happens to have. `mt-auto` on the footer (not `justify-between`
 * on the whole column) is what actually pins it to the bottom: the other
 * rows keep their natural `gap-2` spacing above it, and `mt-auto` alone
 * consumes whatever's left. `justify-between` on the column would instead
 * spread *every* row apart evenly, which is a different (and here, wrong)
 * effect.
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
        // h-full: this Link is what actually carries the card's visible
        // border/shadow (u-card), but its own height used to be pure
        // content-driven — the invisible @container wrapper above it was
        // already stretched to the grid row's height (CSS Grid's default
        // align-items: stretch applies to a block child of any display
        // type), but the Link inside it never consumed that available
        // height, so a card with a short description/no tags visually sat
        // shorter than its neighbours in the same row even though the row
        // itself was already uniform height. h-full is what makes the
        // visible card box actually fill it.
        // rounded-t-lg (8px), not the uniform rounded-card (14px) the top
        // corners used to share with the bottom — a slightly sharper top
        // edge reads as less "boxed in" around the photo, per an explicit
        // instruction. rounded-b-card keeps the body/footer corners as
        // they were; only the photo's own top corners changed.
        'group flex h-full overflow-hidden rounded-t-lg rounded-b-card border border-line bg-surface shadow-[0_8px_20px_-8px_rgba(16,26,46,0.18),0_2px_6px_-2px_rgba(16,26,46,0.08)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_18px_34px_-12px_rgba(16,26,46,0.28),0_6px_16px_-6px_rgba(16,26,46,0.14)]',
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
          // aspect-[16/9], not the previous fixed h-[208px] — a fixed
          // pixel height meant the *effective* aspect ratio silently
          // shifted at every different card width this renders at
          // (homepage carousel item, /listings mobile row, desktop grid
          // column), never matching a wide "edge-to-edge" ratio
          // consistently anywhere. aspect-[16/9] keeps the same real
          // proportions everywhere the card renders, computed live from
          // whatever width it actually gets — the only way to guarantee
          // "wide, immersive photo" holds regardless of layout. Picked
          // over the wider 16/10 named alongside it in the instruction:
          // at this card's typical mobile width, 16/10 comes out *taller*
          // than the previous 208px (worse, not better, for immersion),
          // where 16/9 lands almost exactly where 208px already did.
          'relative shrink-0 overflow-hidden bg-canvas-deep aspect-[16/9]',
          horizontal
            // @[34rem]:aspect-auto cancels the aspect-ratio once the
            // layout flips to a real side-by-side row (the image's height
            // there needs to track the flex row's own content height via
            // h-auto/min-h, not a ratio computed from its own 300px
            // width — leaving aspect-[16/9] active would fight that,
            // since a definite width + auto height still consults
            // aspect-ratio to fill the gap unless it's explicitly reset).
            ? 'w-full @[34rem]:aspect-auto @[34rem]:h-auto @[34rem]:min-h-[13.75rem] @[34rem]:w-[300px]'
            : 'w-full',
        )}
      >
        {images.length > 0 ? (
          <CardImageCarousel
            images={images}
            alt={title}
            sizes={sizes || (horizontal ? '300px' : '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw')}
            onIndexChange={setActiveIndex}
            priority={priority}
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
          <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[0.8125rem] font-semibold shadow-sm">
            {activeIndex + 1}/{images.length}
          </span>
        ) : null}
      </div>

      <div className={cn('flex min-w-0 flex-1 flex-col gap-2', horizontal ? 'p-5' : 'p-5')}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span
            className={cn(
              // font-extrabold (800), not the previous font-bold (700) —
              // Plus Jakarta Sans's real heaviest loaded weight (see
              // app/layout.js's own `weight` list), per the "extra bold
              // price" instruction. Size is unchanged rather than shrunk to
              // the literal `text-xl` (1.25rem) that instruction also
              // named: this is already larger than that, and shrinking an
              // already-prominent price would fight the stated goal of
              // making it read as bigger, not smaller.
              'u-tabular font-extrabold tracking-[-0.02em] text-ink',
              horizontal ? 'text-[1.3125rem] @[34rem]:text-[1.875rem]' : 'text-[1.3125rem]',
            )}
          >
            {/* The design's `qualifier` slot is the converted-currency line
                ("≈ 520 775 000 FC"), which <Price showSubtext> already
                produces from the real, dated rate — rendered inline on the
                price's own baseline here rather than stacked below it. Now
                a real muted pill/badge (`bg-canvas-alt`/`text-ink-70`, this
                app's own chalk-and-ink tokens for the literal
                "bg-slate-100 text-slate-600" pill instruction) instead of
                plain inline text, so the primary USD figure reads
                unambiguously as the headline number and the converted one
                as a secondary reference beside it. */}
            <Price
              amount={price}
              purpose={purpose}
              pricePeriod={pricePeriod}
              showSubtext
              subtextClassName="ml-2 inline-flex items-center rounded-md bg-canvas-alt px-2 py-0.5 text-xs font-semibold tracking-normal text-ink-70"
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

        {/* min-h reserves exactly two lines at this block's own
            text-[0.875rem]/leading-[1.55] (0.875 * 1.55 = 1.35625rem per
            line) regardless of how much text a listing actually has —
            line-clamp-2 alone only caps the *maximum*, it doesn't reserve a
            minimum, so a one-sentence description used to leave the row
            shorter than a neighbour with a full two-line one, and a
            listing with no description at all skipped the block entirely.
            Both now take up the same space; a short or missing summary
            just leaves blank space inside its own reserved box instead of
            shifting everything below it upward. */}
        <p className="line-clamp-2 min-h-[2.75rem] text-[0.875rem] leading-[1.55] text-ink-70">{summary}</p>

        {/* Same reservation for the amenity-tag row: min-h-8 (32px) holds
            the row's height whether or not this listing matched any real
            amenities, so the footer below doesn't creep upward on a card
            with none. */}
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {amenityKeys.map((key) => <AmenityTag key={key} amenityKey={key} />)}
        </div>

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
