'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { Zap } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import SearchBar from './SearchBar';
import { heroDrift } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';

/**
 * Homepage hero, following web/Design's "Accueil — desktop" screen.
 *
 * Two pieces, deliberately siblings rather than nested: a 540px photographic
 * band, then the search panel pulled up over its lower edge by -92px. That
 * overlap is intentionally unchanged now that the panel is a taller
 * four-tier card (toggle / fields / CTA / commune pills): the offset anchors
 * the panel's TOP edge to the photo, so extra height grows downward into the
 * page and the straddle reads the same. The
 * panel used to sit *inside* the hero's centred content column capped at
 * `max-w-2xl`; in the design it is a full-container-width card straddling
 * the hero's bottom edge, which is what this now does.
 *
 * The band starts *below* the fixed header rather than bleeding up under it.
 * It used to carry `-mt-16` (cancelling the layout's `pt-16`) so the photo
 * reached the very top of the viewport with a transparent header over it;
 * the refonte makes the header solid on every route so the wordmark stays
 * legible over any photograph, so there is nothing left to bleed under —
 * see Header.js.
 *
 * Headline is Plus Jakarta Sans at 800 (the family's heaviest real cut),
 * set as a Zillow-style stacked-noun grid — "Appartements. Villas.
 * Terrains. Agences." It was DM Serif Display at regular weight; the
 * refonte asked for a punchier, more authoritative hero and a bold grid
 * is a sans figure. Sizes step 24 -> 36 -> 48px so the block stays short
 * on a phone and never crowds the search panel it sits above.
 *
 * Photo: /public/kaysha-StJWD4ci8wY-unsplash.jpg — supplied directly by the
 * user, replacing the earlier hero-kinshasa.jpg. The filename is Unsplash's
 * own download-attribution naming convention (photographer "kaysha", photo
 * id StJWD4ci8wY), so it's credited below the same way the very first
 * version of this hero (an Unsplash photo) was. Not confirmed to depict
 * Kinshasa specifically — no EXIF/location data was available to check —
 * so the credit doesn't assert a place, only the real source.
 */
export default function Hero({ propertyTypes = [], communes = [], initialCount = null }) {
  const safe = useMotionSafe();

  return (
    <>
      <section className="relative flex h-[26rem] w-full items-center overflow-hidden bg-ink sm:h-[30rem] lg:h-[33.75rem]">
        <motion.div
          className="absolute inset-0"
          initial={safe ? heroDrift.initial : false}
          animate={safe ? heroDrift.animate : undefined}
        >
          <Image
            src="/kaysha-StJWD4ci8wY-unsplash.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        </motion.div>

        {/* Two vertical (180deg) ink washes, not the old single 94deg
            --scrim-hero. That angle-based gradient's line length is
            computed from the box's own aspect ratio — on the wide desktop
            box it worked, but on a narrow/tall mobile box (where the
            headline also wraps to 2 lines and runs further down) its
            78%-falloff point arrived in far fewer pixels, leaving most of
            the text sitting over bare sky. A vertical gradient's line
            length is always the box's height, so it can't break the same
            way across breakpoints. Both layers use the real ink-900 rgba
            already established for --scrim-image, not an off-palette
            slate/black. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(11,17,32,.7) 0%, rgba(11,17,32,.32) 42%, rgba(11,17,32,.12) 65%)' }}
        />
        {/* The real --scrim-image token, reused here to protect the
            transition into the search card at the hero's bottom edge —
            the same bottom-anchored ink fade cards already use for a photo
            with long text on it. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: 'var(--scrim-image)' }}
        />

        <a
          href="https://unsplash.com/photos/StJWD4ci8wY"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-2 right-3 z-10 text-[0.625rem] text-white/40 transition-colors hover:text-white/70"
        >
          Photo by kaysha on Unsplash
        </a>

        <div className="relative z-10 mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8">
          <div className="max-w-[41rem]">
            {/* Glass eyebrow pill. Not `.u-eyebrow` — that utility is a bare
                12px/500 label with no chrome, and this is a bordered
                frosted capsule with its own 11px/700 spec. The bolt is a
                lucide icon rather than the ⚡ emoji: emoji render at
                wildly different weights and colours per platform (and land
                as full-colour glyphs inside a monochrome pill), and this
                codebase's rule is lucide for every icon. `gap-1.5` is
                spacing the icon from the text, which is what it's for. */}
            {/* `tracking-wider` (0.05em) is the brief's value and it holds
                everywhere it fits. At 320px it doesn't: measured in a
                browser, the one-line pill wants 291px against 288px of
                container and wraps to a two-line lozenge. Dropping to
                `tracking-wide` (0.025em) below 360px reclaims ~10px across
                36 uppercase characters — imperceptible at 11px, and enough
                for one clean line with room to spare. Scoped to the
                narrowest phones rather than applied at `sm`, because from
                360px up the wider tracking fits fine. */}
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur-md min-[360px]:tracking-wider">
              <Zap strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-3 w-3 shrink-0" />
              L&apos;immobilier de confiance à Kinshasa
            </p>

            {/* Sans, extrabold — the Zillow-style stacked-noun grid, not the
                DM Serif display line this carried before. Two deliberate
                departures from the brief's class string:
                  - `font-extrabold` at every breakpoint, never
                    `sm:font-black`. Plus Jakarta Sans is subset to
                    400/500/600/700/800 in app/layout.js and the family has
                    no 900 cut at all, so `font-black` would ask the browser
                    to synthesise one — a smeared faux-bold, most visible at
                    exactly this size. 800 is the real ceiling and already
                    reads as black at display scale.
                  - the serif is gone from the h1. layout.js's own font note
                    lists "the hero headline" under BOTH families, so this
                    was already ambiguous; a bold stacked grid is a sans
                    figure and setting DM Serif heavy would fake a weight
                    that face doesn't have either. */}
            <h1 className="text-2xl font-extrabold leading-[1.1] tracking-tight text-white drop-shadow-sm sm:text-4xl md:text-5xl">
              Appartements. Villas. Terrains. Agences.
            </h1>

            {/* text-white/82, not the brief's `text-slate-200/90`: both
                CLAUDE.md files rule out Tailwind's built-in slate scale
                here (it reads as a typo beside our own ink ramp), and
                white at 82% is the value this exact line already used
                against this photograph. */}
            {/* `max-w-md` (448px) is the brief's measure and it is right on
                a phone, where the line wraps mid-phrase naturally. From
                `md` up the type steps to 16px and the sentence wants 478px
                — 30px more than the cap — so it broke with "WhatsApp."
                orphaned on a line of its own. `md:max-w-lg` (512px) clears
                it by 34px and keeps the whole promise on one line, which
                is the point of a one-liner subhead. Measured, not eyeballed. */}
            <p className="mt-2 max-w-md text-xs font-medium text-white/82 drop-shadow sm:text-sm md:max-w-lg md:text-base">
              Biens vérifiés, prix transparents &amp; contact direct sur WhatsApp.
            </p>
          </div>
        </div>
      </section>

      {/* The panel straddles the hero's bottom edge, per the design. */}
      <div className="relative z-20 mx-auto -mt-16 w-full max-w-[1240px] px-4 sm:px-6 lg:-mt-[5.75rem] lg:px-8">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} />
      </div>
    </>
  );
}
