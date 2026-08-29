'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import SearchBar from './SearchBar';
import { heroDrift } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';

/**
 * Homepage hero, following web/Design's "Accueil — desktop" screen.
 *
 * Two pieces, deliberately siblings rather than nested: a 540px photographic
 * band, then the search panel pulled up over its lower edge by -92px. The
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
 * Headline is DM Serif Display (font-display) at --fs-display-l, regular
 * weight, matching the design's hero spec (never bold, never uppercase).
 *
 * Photo: /public/hero-gombe.jpg — an AI-generated image (source file was
 * literally named `Gemini_Generated_Image_*.jpg`), not a real photograph.
 * This is a deliberate, explicit exception to this file's — and
 * web/CLAUDE.md's — usual rule that a hero image must be a real, licensed
 * photo: raised directly with the client, who chose to use it anyway,
 * unlabeled, over the alternative of keeping the previous real photo or
 * adding an "AI-generated" disclosure. No photographer credit link below
 * (unlike the two real photos this hero has carried before) — there is no
 * license to satisfy for the client's own generated asset.
 *
 * object-[center_72%], not the container default: the source image (1253×832)
 * is roughly 55% sky above the horizon, with the actual subject — a
 * motorcyclist heading down the road, the framing the client asked to keep —
 * sitting in the bottom third. This hero band is short and wide, so a plain
 * centred crop would cut most of that subject away in favour of empty sky;
 * biasing the vertical anchor down keeps the rider in frame at every
 * breakpoint instead.
 */
export default function Hero({ propertyTypes = [] }) {
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
            src="/hero-gombe.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[center_72%]"
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

        <div className="relative z-10 mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8">
          <div className="max-w-[41rem]">
            <p className="u-eyebrow mb-5 text-white/72">Immobilier à Kinshasa</p>

            <h1 className="font-display text-[2.5rem] font-normal leading-[1.04] tracking-[-0.018em] text-white sm:text-[3.25rem] lg:text-[3.75rem]">
              Trouvez le bien qui vous ressemble
            </h1>

            <p className="mt-5 max-w-[32.5rem] text-[1.125rem] leading-[1.56] text-white/82">
              Appartements, villas et parcelles vérifiés à Kinshasa — prix en dollars ou en francs, contact direct par
              WhatsApp.
            </p>
          </div>
        </div>
      </section>

      {/* The panel straddles the hero's bottom edge, per the design. */}
      <div className="relative z-20 mx-auto -mt-16 w-full max-w-[1240px] px-4 sm:px-6 lg:-mt-[5.75rem] lg:px-8">
        <SearchBar propertyTypes={propertyTypes} />
      </div>
    </>
  );
}
