import Link from 'next/link';

/**
 * Real brand marks, supplied by the client.
 *
 * Two wordmark files exist because the source lockup only reads correctly
 * against one background each: `logo-light.png` is the colored (blue/green)
 * wordmark, alpha-keyed to a transparent background, for use on white/stone
 * surfaces. `logo-dark.png` is the same lockup in solid white, for use over
 * the hero photo or any dark/blue fill where the colored version would
 * lose contrast. Both were produced from the client's flattened JPEG
 * exports by keying out the flat background color per-pixel (not cropped
 * from an existing transparent asset — none was supplied) — see the alpha
 * channel in either file for the result.
 *
 * `icon-light.png` isolates just the roofline chevron above the wordmark
 * (cropped above the point where the source art fuses the roofline into the
 * "Pl" letterforms) for use as the Monogram and as the source for
 * `app/favicon.ico` / `public/brand/apple-touch-icon.png`.
 *
 * Deliberately NOT recolored to the site's blue/ink palette — the client
 * chose "logo as supplied, blue everywhere else" when the two clashed.
 * The logo's blue/green is a fixed brand mark; it does not feed any other
 * accent color in the app (buttons, active filters, map pins, etc. all stay
 * blue — see app/globals.css).
 */
const LOGO_ASPECT = { width: 2354, height: 746 };

export function Wordmark({ inverted = false, className = '' }) {
  const src = inverted ? '/brand/logo-dark.png' : '/brand/logo-light.png';

  return (
    <Link href="/" aria-label="Lukka Place — accueil" className={`inline-flex items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static local
          asset, not a Supabase-sourced photo; next/image adds no real value
          here and the two-variant swap by background is simpler as a plain
          img. width/height set the intrinsic aspect ratio so h-* + w-auto
          scales without layout shift.

          h-7/h-8, not the previous h-6/h-7 — a modest size bump for more
          visual weight in the header, per an explicit "bolder logo"
          instruction. Size is the only real lever here: this is a supplied
          raster PNG (see the doc comment above), so there's no font-weight
          or SVG fill to strengthen — a heavier stroke would mean asking for
          new source art, not a CSS change. */}
      <img src={src} alt="Lukka Place" width={LOGO_ASPECT.width} height={LOGO_ASPECT.height} className="h-7 w-auto sm:h-8" />
    </Link>
  );
}

export function Monogram({ className = '' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/icon-square-512.png"
      alt="Lukka Place"
      width={512}
      height={512}
      className={`h-8 w-8 ${className}`}
    />
  );
}
