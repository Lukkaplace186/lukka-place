'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import SearchBar from './SearchBar';
import { heroDrift } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';

/**
 * Homepage hero.
 *
 * `-mt-16` pulls this up under the fixed header (app/(site)/layout.js adds a
 * matching pt-16 to everything else), so the photograph runs to the very top
 * of the viewport and the header sits transparently over it — see Header.js,
 * which only goes solid once scrolled.
 *
 * Headline is DM Serif Display (font-display), matching web/Design's own
 * hero spec (--fs-display-l, regular weight, never bold, never uppercase).
 * This is the one place the accent face gets to be the loudest thing on the
 * page — every section heading below it uses the same face at a smaller size.
 *
 * Photo: /public/hero.jpg — client-supplied, sourced from Unsplash
 * ("frames-for-your-heart", photo ncYuMo5Yx10). Unsplash's own license
 * doesn't require attribution, but this site's convention (see the previous
 * Kinshasa-night photo this replaced) has been real licence + visible
 * credit whenever a real photographer is identifiable, so that continues
 * here. Cropped from the original tall portrait to a landscape band around
 * the actual subject (building/truck/palm) before shipping — the source's
 * lower half is empty lawn, and shipping it uncropped would have both
 * bloated the file and risked object-cover's default center-crop pushing
 * the subject out of frame on a wide hero.
 *
 * Not confirmed to depict Kinshasa specifically — it is a real, licensed
 * exterior photo used as an atmospheric hero image, the same role the prior
 * photo played. If a real, licensed Kinshasa-specific daylight photo is
 * ever sourced, that would be the more precise choice.
 */
export default function Hero() {
  const safe = useMotionSafe();

  return (
    <section className="relative -mt-16 flex min-h-[38rem] w-full items-center overflow-hidden bg-ink lg:h-[88vh] lg:max-h-[54rem]">
      <motion.div
        className="absolute inset-0"
        initial={safe ? heroDrift.initial : false}
        animate={safe ? heroDrift.animate : undefined}
      >
        <Image
          src="/hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </motion.div>

      {/* Royal scrim (web/Design's --scrim-hero: a left-to-right royal-ink
          wash) rather than flat black — it keeps the photograph's own
          colour and ties the image straight into the WhiteBlue Royal
          palette instead of greying it out. */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(94deg, rgba(12,29,80,.78) 0%, rgba(12,29,80,.42) 52%, rgba(12,29,80,.08) 78%)' }}
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0B1120]/60 to-transparent" />

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 pt-16 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="u-eyebrow mb-5 text-white/70">Immobilier à Kinshasa</p>

          <h1 className="font-display text-[2.75rem] font-normal leading-[1.04] tracking-[-0.018em] text-white sm:text-6xl lg:text-[4.25rem]">
            Trouvez le bien
            <br />
            qui vous ressemble
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75">
            Appartements, villas et parcelles vérifiés à Kinshasa — prix en dollars ou en francs, contact direct par
            WhatsApp.
          </p>

          <div className="mt-8">
            <SearchBar />
          </div>
        </div>
      </div>

      <a
        href="https://unsplash.com/photos/ncYuMo5Yx10"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-3 z-10 text-[0.625rem] text-white/40 transition-colors hover:text-white/70"
      >
        Photo via Unsplash
      </a>
    </section>
  );
}
