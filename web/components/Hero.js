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
 * photo. The Unsplash credit link that used to sit in the bottom-right of
 * this band has been REMOVED rather than carried over: it pointed at
 * unsplash.com/photos/StJWD4ci8wY, which is a different photograph from the
 * one now rendered, so leaving it would have credited the wrong source. This
 * image's own licence and attribution are not yet known — if it needs a
 * credit, it goes back in here, in the same position as before.
 *
 * Imported statically rather than referenced as a /public path (the
 * convention every other image in this app uses). Deliberate, for load
 * speed: a static import is emitted with a content hash, so it is served
 * `Cache-Control: immutable` and never revalidated on a repeat visit; Next
 * also derives intrinsic width/height at build time (no layout shift) and
 * generates the blur placeholder below from the real file. A /public path
 * gets none of those. Re-encoded from the supplied 717KB original to 132KB
 * at mozjpeg q82 — an 82% saving on the largest asset above the fold.
 *
 * NOTE the source is only 1253x832. That is smaller than this band renders
 * on a wide or HiDPI display, and Next will not upscale past the original,
 * so the photo softens beyond ~1250 CSS px. A larger original is the only
 * fix; nothing in this component can recover detail that is not in the file.
 *
 * `heroDrift` (an 18s scale animation on the image) has been REMOVED. It is
 * incompatible with the backdrop-filter panel below: a blurred backdrop over
 * a continuously transforming layer forces the browser to re-rasterise the
 * blur every frame for the full 18 seconds, which is exactly the sustained
 * main-thread cost the hero must not carry. Static image, blur rasterised
 * once. To bring the drift back, the panel has to lose its backdrop-blur —
 * the two cannot both be free.
 * ---------------------------------------------------------------------------
 */
export default function Hero({ propertyTypes = [], communes = [], initialCount = null }) {
  const t = useT();

  return (
    <>
      <section className="relative flex h-[26rem] w-full items-center overflow-hidden bg-ink sm:h-[30rem] lg:h-[33.75rem]">
        {/* No scrim, no gradient, no tint. The sky stays at full brightness
            across the whole band — contrast is bought locally by the panel
            below instead of globally by darkening the photograph. */}
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
          {/* Frosted panel. `bg-white/45`, not the briefed `bg-white/30`:
              measured against this exact photo, /30 leaves the worst pixel
              under the panel at 4.08:1, just under the 4.5:1 AA floor,
              because backdrop-blur averages the backdrop but never darkens
              it — a dark tree line smears through rather than disappearing.
              /45 is the nearest value that clears it, at 5.99:1 worst-pixel,
              and still reads as translucent glass rather than a solid card.

              Text is ink, not white. On a white-tinted panel over a bright
              sky, white type measured 1.49:1 — 1.0:1 is literally invisible,
              so that combination cannot be made to work at any opacity. The
              panel's stated job is to ensure contrast, and over a sunlit sky
              a light panel can only do that with dark text.

              `w-fit` matters: the panel must hug the type. Stretched to the
              full column it becomes a milky slab across the sky, which is
              the full-bleed wash this design is trying to avoid. */}
          <div className="w-fit max-w-[41rem] rounded-2xl border border-white/50 bg-white/45 p-5 shadow-lg backdrop-blur-md sm:p-6 lg:p-7">
            <h1 className="text-4xl font-extrabold leading-[1.02] tracking-tight text-ink min-[360px]:tracking-tighter sm:text-5xl md:text-6xl">
              {t('home.hero.title')}
            </h1>

            <p className="mt-3 max-w-md text-sm font-bold text-ink/80 sm:text-base md:max-w-lg">
              {t('home.hero.subtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* The panel straddles the hero's bottom edge, per the design. This is
          where the real call-to-action lives (the "Rechercher" submit inside
          SearchBar); it stays a sibling straddling the band rather than
          moving inside the frosted panel, because the -mt-16 overlap is the
          documented anatomy of this screen. */}
      <div className="relative z-20 mx-auto -mt-16 w-full max-w-[1240px] px-4 sm:px-6 lg:-mt-[5.75rem] lg:px-8">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} />
      </div>
    </>
  );
}
