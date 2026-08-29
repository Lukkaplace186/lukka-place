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
 * Photo: /public/kaysha-StJWD4ci8wY-unsplash.jpg — supplied directly by the
 * user, replacing the earlier hero-kinshasa.jpg. The filename is Unsplash's
 * own download-attribution naming convention (photographer "kaysha", photo
 * id StJWD4ci8wY), so it's credited below the same way the very first
 * version of this hero (an Unsplash photo) was. Not confirmed to depict
 * Kinshasa specifically — no EXIF/location data was available to check —
 * so the credit doesn't assert a place, only the real source.
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
