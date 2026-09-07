'use client';

import Image from 'next/image';
import SearchBar from './SearchBar';
import heroSunlit from '../Hero/hero-sunlit.jpg';
import { useT } from '@/lib/i18n/client';

/**
 * Homepage hero, following web/Design's "Accueil — desktop" screen.
 *
 * Two pieces, deliberately siblings rather than nested: a 540px photographic
 * band, then the search panel pulled up over its lower edge by -92px. That
 * overlap is intentionally unchanged now that the panel is a taller
 * four-tier card (toggle / fields / CTA / commune pills): the offset anchors
 * the panel's TOP edge to the photo, so extra height grows downward into the
 * page and the straddle reads the same.
 *
 * The band starts *below* the fixed header rather than bleeding up under it.
 * The header is solid on every route so the wordmark stays legible over any
 * photograph, so there is nothing left to bleed under — see Header.js.
 *
 * Headline is Plus Jakarta Sans at 800 (the family's heaviest real cut), set
 * as a Zillow-style stacked-noun grid — "Appartements. Villas. Terrains.
 * Agences." Sizes step 36 -> 48 -> 60px, so the headline carries the hero
 * alone. The band's own height is unchanged, and the search panel still
 * straddles its bottom edge — verified above the fold at 320/375/1280.
 *
 * ---------------------------------------------------------------------------
 * Photo: Hero/hero-sunlit.jpg — a bright, sunlit clear-sky frame supplied
 * directly by the user, replacing the overcast kaysha-StJWD4ci8wY Unsplash
 * photo. The Unsplash credit that used to sit bottom-right of this band was
 * REMOVED rather than carried over: it pointed at a different photograph.
 * This image's own licence and attribution are not yet known — if it needs a
 * credit, it goes back in here, in the same position as before.
 *
 * Imported statically rather than referenced as a /public path (the
 * convention every other image in this app uses). Deliberate, for load
 * speed: a static import is emitted with a content hash, so it is served
 * `Cache-Control: immutable` and never revalidated on a repeat visit; Next
 * also derives intrinsic width/height at build time (no layout shift) and
 * generates the blur placeholder below from the real file. Re-encoded from
 * the supplied 717KB original to 132KB at mozjpeg q82.
 *
 * NOTE the source is only 1253x832. That is smaller than this band renders
 * on a wide or HiDPI display, and Next will not upscale past the original,
 * so the photo softens beyond ~1250 CSS px. A larger original is the only
 * fix; nothing here can recover detail that is not in the file.
 *
 * `heroDrift` (an 18s scale animation) stays REMOVED. It was originally
 * dropped because it forced a backdrop-filter to re-rasterise every frame;
 * that panel is gone now, so restoring the drift would be cheap again —
 * it is simply still out, for load speed. Re-add via lib/motion.js if the
 * movement is wanted back.
 * ---------------------------------------------------------------------------
 */
export default function Hero({ propertyTypes = [], communes = [], initialCount = null }) {
  const t = useT();

  return (
    <>
      <section className="relative flex h-[26rem] w-full items-center overflow-hidden bg-ink sm:h-[30rem] lg:h-[33.75rem]">
        {/* Nothing sits between the photo and the type: no scrim, no
            gradient, no frosted panel. The sunlit sky is the hero. */}
        <Image
          src={heroSunlit}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="100vw"
          className="object-cover"
        />

        <div className="relative z-10 mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8">
          <div className="max-w-[41rem]">
            {/* White type straight on the photograph, per an explicit
                product decision to keep the sky completely unobstructed.

                Recorded honestly, because it is a real accessibility
                trade and not an oversight: measured against this exact
                image, white here is 1.61:1 at the headline and 1.78:1 at
                the subheadline, dropping to ~1.00:1 where a cloud sits
                directly behind a glyph (1.00:1 means the type and its
                background are the same colour). WCAG AA wants 4.5:1, or
                3:1 for the 60px headline. Neither line reaches either bar,
                and no arrangement of white-on-bright-sky can.

                The layered text-shadow below is the only legibility lever
                left once a background box is ruled out, and it is a real
                one: a tight, near-opaque 3px shadow draws a dark contour
                immediately around each glyph, and the wide 24px pass lifts
                the whole word off the cloud behind it. WCAG's contrast
                model does not score shadows, so this does not move the
                numbers above — it does materially help a human read it.

                If the ratios ever need to pass, the options are a
                background behind the type, or moving the block down-left
                over the dark road surface. Both were measured; both work.
                Neither is in effect. */}
            <h1 className="text-4xl font-extrabold leading-[1.02] tracking-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0_/_0.75),0_6px_24px_rgb(0_0_0_/_0.55)] min-[360px]:tracking-tighter sm:text-5xl md:text-6xl">
              {t('home.hero.title')}
            </h1>

            <p className="mt-3 max-w-md text-sm font-bold text-white [text-shadow:0_1px_3px_rgb(0_0_0_/_0.8),0_4px_16px_rgb(0_0_0_/_0.6)] sm:text-base md:max-w-lg">
              {t('home.hero.subtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* The panel straddles the hero's bottom edge, per the design. This is
          where the real call-to-action lives (the "Rechercher" submit inside
          SearchBar); the -mt-16 overlap is the documented anatomy of this
          screen. */}
      <div className="relative z-20 mx-auto -mt-16 w-full max-w-[1240px] px-4 sm:px-6 lg:-mt-[5.75rem] lg:px-8">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} />
      </div>
    </>
  );
}
