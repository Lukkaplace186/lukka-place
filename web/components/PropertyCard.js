'use client';

import { useState } from 'react';
import Link from 'next/link';
import CardImageCarousel from './CardImageCarousel';
import FavoriteButton from './FavoriteButton';
import WhatsAppCTA from './WhatsAppCTA';
import CallCTA from './CallCTA';
import AgencyLogo from './AgencyLogo';
import Price from './Price';
import SpecItem, { SpecCell } from './SpecItem';
import { CardBadges, AmenityTag } from './ListingBadges';
import {
  listingImages, formatFreshness, specItems, typeLabel, feedLocationLine, matchedAmenities,
} from '@/lib/listingView';
import { cn } from '@/lib/utils';

/**
 * The listing card, on a Rightmove-style four-zone hierarchy.
 *
 *   1. PHOTO      — CardImageCarousel (swipeable, hover arrows, dots) under
 *                   the image scrim: real status badge (LOUÉ / VENDU, SOUS
 *                   COMPROMIS) top-left, favourite heart top-right, "1/13"
 *                   glass capsule bottom-right.
 *   2. PRICE      — the USD headline with the converted-FC figure inline
 *                   beside it as a chalk pill, both resolved by <Price>.
 *   3. DATA       — location title; type + bed/bath/area specs on one line
 *                   with the agency badge floated right; the feature-chip
 *                   row; then the green freshness line and the reference.
 *   4. ACTION BAR — a hairline-divided footer strip: Appeler + WhatsApp.
 *
 * **The description paragraph is gone, and the feature chips are why that
 * is a compression rather than a loss.** The paragraph was a reserved
 * two-line block (`line-clamp-2 min-h-[2.75rem]`) costing ~44px on every
 * card whether or not the listing had anything worth reading there — and
 * the genuinely decisive facts buried inside it (climatisation, groupe
 * électrogène, forage/citerne) are exactly what zone 3's chip row now
 * states directly. Those chips are not decoration: in Kinshasa, power and
 * water are frequently the deciding factor, and burying them mid-paragraph
 * made them invisible in a feed. `descriptionSnippet` (lib/listingView.js)
 * now has no caller; the helper is left in place rather than deleted, same
 * as the other real-but-unimported modules this app keeps around.
 *
 * An earlier pass of this refactor dropped the chip row entirely, on the
 * reasoning that zone 4's ~46px of action bar had made the card taller than
 * the 451px it replaced on precisely the listings that matched an amenity
 * (421px without chips, 462px with). That was the wrong trade and was
 * corrected: the chips are the highest-value content on the card, and the
 * height is bought back elsewhere instead — the converted-currency figure
 * went back inline rather than stacked (~16px), and the chip row is not
 * height-reserved, so a listing matching nothing simply doesn't render it.
 *
 * Two deliberate reversals of decisions this file previously documented,
 * both on explicit instruction — recorded rather than quietly applied:
 * contact CTAs are back on the card (the earlier note deferred all contact
 * to the listing page's EnquiryCard / MobileListingBar), and the price is
 * `font-extrabold` again, reversing the `font-medium tracking-[0.1px]` set
 * here from a measurement of Rightmove's own card price (24px / weight
 * 500).
 *
 * Row heights need none of the old `min-h-*` reservations to stay uniform:
 * the grid stretches each card (`h-full` on the Link) and `mt-auto` on the
 * action bar consumes whatever slack is left, so the bar lands at the same
 * y on every card in a row. Those reservations were belt-and-braces on top
 * of that mechanism, never the mechanism itself. A card that matches more
 * chips is genuinely taller than one that matches none, and within a grid
 * row the tallest sets the row — that is correct, not a defect.
 *
 * Card chrome (border-line plus a real resting shadow that lifts on hover,
 * rounded-t-lg over rounded-b-card) is unchanged.
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
    id, title, price, purpose, reference, created_at: createdAt,
    price_period: pricePeriod, agency_name: agencyName, agency_logo_url: agencyLogoUrl,
  } = listing;

  const horizontal = layout === 'horizontal';
  const images = listingImages(listing);
  const [activeIndex, setActiveIndex] = useState(0);
  const specs = specItems(listing);
  const type = typeLabel(listing);
  const where = feedLocationLine(listing);
  const freshness = formatFreshness(createdAt);
  const amenities = matchedAmenities(listing, 3);
  // Only when this listing genuinely has an agency attached. AgencyLogo's own
  // no-agent fallback is the Lukka Place wordmark, which is honest on a
  // detail page but wrong in a feed — an unconditional slot would stamp the
  // same platform mark on every card that simply has no agency yet, which
  // reads as an attribution rather than as an absence.
  //
  // That absence is real and partial, not universal: measured live against
  // /listings, 8 of 12 rows return a genuine `agency_logo_url` (real files
  // under Supabase storage's `avatars/agents/…`, loading at their natural
  // size) and 4 return null. Several doc comments in this codebase — this
  // file's predecessor, AgencyLogo.js, WhatsAppCTA.js — still assert that
  // `agent_id` is NULL on *every* row; that was true when written and is
  // now stale. Do not re-derive behaviour from those notes without checking.
  const hasAgency = Boolean(agencyName || agencyLogoUrl);

  return (
    // Own `@container` so the horizontal layout's breakpoints resolve against
    // this card's own rendered width, not a caller's grid — the card is
    // dropped into panes of very different widths (/favoris full bleed, the
    // /listings results column beside a 400px map) and must self-correct.
    <div className={cn('@container', horizontal && 'w-full')}>
    <Link
      href={`/listings/${id}`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={cn(
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
      {/* ------------------------- Zone 1: photo ------------------------- */}
      <div
        className={cn(
          // aspect-[16/10] per the card spec, and a ratio rather than a fixed
          // pixel height so the same real proportions hold at every width
          // this renders at (homepage carousel item, /listings mobile row,
          // desktop grid column). It is 21px taller than the 16/9 this
          // carried before, at a 343px mobile card — a real cost, taken
          // because the ratio was specified explicitly; `aspect-[16/9]` is
          // the one-token revert if that trade stops being worth it.
          'relative shrink-0 overflow-hidden bg-canvas-deep aspect-[16/10]',
          horizontal
            // @[34rem]:aspect-auto cancels the ratio once the layout flips to
            // a real side-by-side row — the image's height there tracks the
            // flex row's content height, not a ratio off its own width.
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

        {/* Status badge top-LEFT, favourite heart top-RIGHT, per the card
            spec's overlay assignment. Both moved back here: the previous
            pass had put the photo counter top-left, the status badge
            top-right and Save down in the action bar. The heart returning
            to the photo is also what frees the action bar to be two contact
            actions (Call + WhatsApp) rather than one action and a Save. */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          <CardBadges listing={listing} />
        </div>

        <div className="absolute right-3 top-3 z-10">
          <FavoriteButton listingId={id} />
        </div>

        {/* Photo counter back to bottom-right, where it does not collide
            with the status badge that now owns the top-left corner. Still
            the glass capsule and never the gradient badge — the design is
            explicit that the two are never combined on one edge, and the
            scrim already darkens this edge enough to carry white text. */}
        {images.length > 1 ? (
          <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-bold shadow-sm">
            {activeIndex + 1}/{images.length}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        {/* ------------------------- Zone 2: price ------------------------ */}
        <div
          className={
            // font-extrabold (800), not the spec's font-black (900):
            // app/layout.js subsets Plus Jakarta Sans to 400-800, so a 900
            // request is synthesised by the browser into a smeared faux-bold
            // rather than rendered from a real cut. 800 is the family's true
            // ceiling here and is what "black" has to mean on this stack.
            //
            // text-2xl is the spec's size and is what this renders at
            // everywhere there is room for it. The `@[19rem]` step down to
            // text-xl is not a hedge: measured at a 320px viewport (a 288px
            // card), a longer rental price plus the inline converted-FC pill
            // — "1 500 $ / mois  ≈ 3,4 M FC / mois" — wraps onto a second
            // line at 24px, which pushes the whole card 30px taller and
            // breaks the price/location rhythm on exactly the cheapest
            // devices. A container query, not a viewport breakpoint, because
            // this card also renders in a ~400px results column beside the
            // map at full desktop width, where the viewport says nothing
            // useful about how much room the price actually has.
            'u-tabular text-xl font-extrabold leading-tight tracking-tight text-ink @[19rem]:text-2xl'
          }
        >
          {/* <Price> already resolves both sides from the real, dated rate and
              marks whichever one is derived with "≈" — see Price.js. Back to
              one baseline with the converted figure as an inline chalk pill
              (`ml-2`), rather than the stacked two-line block of the previous
              pass: the spec's own price line is `400 $ / mois  ≈ 916k FC /
              mois`, and inline also buys back the ~16px that stacking cost.
              `inline-block` on the pill keeps it from being split across
              lines if it ever does wrap. */}
          <Price
            amount={price}
            purpose={purpose}
            pricePeriod={pricePeriod}
            showSubtext
            subtextClassName="ml-2 inline-block rounded-md bg-canvas-alt px-2 py-0.5 align-middle text-[0.75rem] font-bold leading-normal tracking-normal text-ink-45"
          />
        </div>

        {/* ---------------- Zone 3: location, specs, agency ---------------- */}
        {/* The card's title, in everything but name — this app has no separate
            street/town split to give Rightmove's two-line treatment, and the
            listing's own `title` column is the long sentence ("Appartement de
            2 chambres à louer à Kalamu…") this card exists to not print. So
            the location line carries the title weight: 16px/800 on full-ink,
            up from 14px/700. */}
        {(where || hasAgency) ? (
          <div className="flex items-center justify-between gap-3">
            {where ? <p className="min-w-0 truncate text-base font-extrabold leading-snug tracking-tight text-ink">{where}</p> : <span />}
            {/* The agency badge sits on the title row, not on the spec rail
                below it. Measured at 375px: sharing the rail's row cost it
                ~52px of width, which was exactly enough to push the third
                column ("SALLES DE BAIN") onto a second line and leave a
                ragged two-line rail with a half-empty first line. The title
                line is already `truncate`, so it gives the badge that width
                without any wrap of its own. */}
            {hasAgency ? <AgencyLogo logoUrl={agencyLogoUrl} name={agencyName} /> : null}
          </div>
        ) : null}

        {/* Rightmove's labelled spec rail, replacing the single inline
            "Appartement · 2 ch · 1 sdb" line. Each column is a tiny uppercase
            label over an extrabold value (SpecCell, components/SpecItem.js),
            which is what turns a run-on of abbreviations into something
            scannable at a glance — the point of the pattern.

            `flex-wrap` with `gap-x-5`, not a fixed `grid-cols-3`: the number
            of real columns varies per listing (type is always there, beds and
            baths usually, area and door count only sometimes — see
            specItems()), so a fixed column count would either strand empty
            cells or clip a fourth. Wrapping lets a listing with four specs
            drop cleanly to a second line at 320px instead of compressing all
            four. `items-start` keeps the agency badge on the label's baseline
            rather than centred against a two-line rail. */}
        {(specs.length > 0 || type) ? (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 pt-0.5">
            {type ? (
              <SpecCell label="Type de bien">
                <span className="truncate">{type}</span>
              </SpecCell>
            ) : null}
            {specs.map((spec) => <SpecItem key={spec.key} spec={spec} variant="stacked" />)}
          </div>
        ) : null}

        {/* -------- Feature chips: the reason the description could go -------
            Climatisé / Groupe / Citerne are decisive in Kinshasa, and they
            were previously reachable only by reading the description
            paragraph this card no longer prints. Promoting them to their own
            chip row is what makes removing that paragraph a compression
            rather than a loss of information.

            Each chip is a real word-boundary match against this listing's own
            title/description (lib/listingView.js's matchedAmenities, the same
            AMENITY_KEYWORDS list the "Plus de filtres" checkboxes filter
            with server-side) — never an invented flag, and `matched` is
            threaded through so a "forage" listing reads Forage and a
            "citerne" one reads Citerne instead of both sharing one label.

            Three, not two: the spec's own example row shows three. The row
            wraps (`flex-wrap`) and each chip is `shrink-0 whitespace-nowrap`,
            so on a 320px screen a third chip drops to a second line intact
            rather than compressing or clipping the other two. */}
        {amenities.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {amenities.map(({ key, matched }) => (
              <AmenityTag key={key} amenityKey={key} matched={matched} size="compact" />
            ))}
          </div>
        ) : null}

        {(freshness || reference) ? (
          <div className="flex items-center justify-between gap-3">
            {/* Emerald, matching the spec's freshness pill. The wording is
                "Publiée", not "Vérifiée" — see formatFreshness's own note in
                lib/listingView.js: there is no verification timestamp in the
                schema to date that claim from.

                `text-green-ink`, not `text-green-deep`: at 11px this is
                body-size text, and green-deep measures 3.86:1 on the card's
                white surface — under AA. green-ink is the same hue at
                5.34:1. See the green block in app/globals.css. */}
            <span className="text-[0.6875rem] font-bold tracking-tight text-green-ink">{freshness || ''}</span>
            {reference ? (
              <span className="u-tabular shrink-0 text-[0.6875rem] font-bold text-ink-45">{reference}</span>
            ) : null}
          </div>
        ) : null}

        {/* ----------------------- Zone 4: action bar ----------------------
            Call + WhatsApp, the spec's two contact actions. Save is not here
            any more — the heart went back onto the photo (top-right), and
            two Save affordances on one card would be one too many.

            mt-auto (not justify-between on the column) is what pins this to
            the bottom of a stretched grid cell: every row above keeps its
            natural gap and this consumes the slack. Both buttons call
            preventDefault + stopPropagation, so neither triggers the
            surrounding card <Link> — and both are real <button>s rather than
            <a href="tel:">/<a href="wa.me"> precisely because they sit inside
            that Link and HTML forbids nesting anchors (see CallCTA.js and
            WhatsAppCTA.js, where that bug is documented from a live repro).

            Both render nothing when no phone number is configured at all, so
            on a misconfigured deploy this degrades to an empty bar rather
            than to links pointing at `tel:undefined`. */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-2.5">
          <CallCTA listing={listing} variant="link" />
          <WhatsAppCTA listing={listing} variant="link" />
        </div>
      </div>
    </Link>
    </div>
  );
}
