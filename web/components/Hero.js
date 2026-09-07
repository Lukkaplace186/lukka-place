'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import SearchBar from './SearchBar';
import { heroDrift } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';
import { useT } from '@/lib/i18n/client';

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
 * Terrains. Agences." — in pure #fff over a black wash (lightened 15 points
 * when the photo itself was brightened; see the scrim note below). It was DM
 * Serif Display at regular weight, then a smaller sans pass with an
 * eyebrow pill above it; the pill is gone and the sizes now step
 * 36 -> 48 -> 60px, so the headline carries the hero alone. The band's
 * own height is unchanged, and the search panel still straddles its
 * bottom edge at -mt-16 — verified above the fold at 320/375/1280.
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
  const t = useT();
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

        {/* Top-anchored dark wash, sized by measurement rather than by eye.

            The photo underneath now carries +20% brightness / +15%
            saturation and a linear(1.10, -13) contrast curve baked into the
            asset on disk, so the old black/85 -> black/60 scrim would spend
            most of that gain straight back. This is 15 points lighter at
            both stops -- the lightest wash measured that still clears WCAG
            AA over the brightened photo, so the top of the band reads
            materially more open without putting white type at risk.

            Sampled off the enhanced asset over a 1280x540 band, compositing
            this gradient row by row and measuring white against the result:
            6.22:1 at the headline, 5.30:1 at the subheadline. Both clear
            4.5:1, which is the floor that matters here -- the subheadline
            is 14px bold and gets no large-text exemption (WCAG's starts at
            18.66px bold), and the 60px headline clears its own 3:1 bar with
            room to spare.

            For reference, the lighter `from-slate-900/35 via-slate-900/10
            to-transparent` treatment this replaced measured 2.04:1 / 1.95:1
            -- under AA on both lines, and under even the large-text bar on
            the headline. Don't lighten back toward it without re-measuring
            against the current asset.

            Deliberately black, not the ink-900 rgba the pre-vibrancy layers
            used: ink carries a blue cast that tints a white headline
            slightly cool against a blue sky. Neutral black darkens without
            colouring the text it sits under. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/45 via-65% to-transparent"
        />

        <a
          href="https://unsplash.com/photos/StJWD4ci8wY"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-2 right-3 z-10 text-[0.625rem] text-white/40 transition-colors hover:text-white/70"
        >
          {t('home.hero.photoCredit')}
        </a>

        <div className="relative z-10 mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8">
          <div className="max-w-[41rem]">
            {/* Eyebrow pill removed outright — the headline is the whole
                statement now, and a badge above it was competing for the
                same first glance at the size this h1 has grown to. */}

            {/* Pure #fff, no opacity, no tint. `font-extrabold` (800) and
                not the brief's `font-black` (900): Plus Jakarta Sans has no
                900 cut and app/layout.js subsets it to 400-800, so 900
                would be synthesised — a smeared faux-bold, and at 60px the
                smearing is the most visible thing on the page. 800 is the
                family's real ceiling.

                `tracking-tighter` (-0.05em) is the brief's value and is
                kept from 360px up. Below that it stays -0.025em: at 36px
                the longest word, "Appartements.", is already within a few
                px of a 288px container, and over-tightening a 36px line
                that close to its box is where a stacked grid starts
                colliding rather than reading as one. */}
            <h1 className="text-4xl font-extrabold leading-[1.02] tracking-tight text-white drop-shadow-xl min-[360px]:tracking-tighter sm:text-5xl md:text-6xl">
              {t('home.hero.title')}
            </h1>

            {/* Pure white at 95% — the brief's `opacity-95`, applied as
                text-white/95 so it tints only the type and not any child
                box. `md:max-w-lg` for the same measured reason as before:
                at max-w-md the 16px line wants 478px against a 448px cap
                and breaks with "WhatsApp." orphaned on its own line. */}
            <p className="mt-3 max-w-md text-sm font-bold text-white/95 drop-shadow-md sm:text-base md:max-w-lg">
              {t('home.hero.subtitle')}
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
