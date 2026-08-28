import { Plus_Jakarta_Sans, DM_Serif_Display } from 'next/font/google';
import './globals.css';
import { SITE_URL } from '@/lib/constants';

/*
 * Two families, sans-led — matches web/Design's "WhiteBlue Royal" system
 * exactly (both are its named brand-font stand-ins, not a substitution on
 * this app's part: see web/Design/_ds/.../readme.md's "Fonts" section).
 *
 * Plus Jakarta Sans is the workhorse: the hero headline, all UI, filters,
 * prices, card data and body copy. Its warm, rounded geometric character
 * (matching the Zoopla-style reference) replaces Inter here — same
 * sans-led role, still entirely weight/size driven for hierarchy, and
 * still has proper tabular numerals for a grid of prices. Subset to the
 * five weights the type scale actually uses (400/500/600/700/800) rather
 * than shipping the whole variable-weight range over mobile data.
 *
 * DM Serif Display is an accent only — the hero headline, section titles,
 * /a-propos, the detail-page description heading — regular weight only
 * (the face has no bold cut; setting it heavier would fake a weight that
 * doesn't exist). It is what keeps the site from looking like every other
 * portal. It is never used for UI or data. Replaces Fraunces, which served
 * the same accent role under the previous "Prestige White" pass but isn't
 * the face this design system specifies.
 */
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const dmSerifDisplay = DM_Serif_Display({
  variable: '--font-dmserif',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});

const SITE_TITLE = 'Lukka Place — Immobilier à Kinshasa';
const SITE_DESCRIPTION = 'Trouvez votre prochain bien à louer ou à vendre à Kinshasa.';

// Real brand asset: public/brand/logo-dark.png (the client-supplied white
// wordmark, alpha-transparent — see Brand.js's own doc comment) composited
// onto a solid #1D5BD8 fill, at the three sizes each surface actually
// needs. Not a placeholder or a re-drawn logo — same lockup pixels the
// header/footer already render, just given a real background instead of
// transparency for the surfaces (favicon tiles, share-card previews) that
// need one. Regenerate by re-running the compositing script (sharp is
// already a project dependency) if the source lockup ever changes.
const OG_IMAGE = '/og-image.png';

export const metadata = {
  // Required for any relative openGraph/twitter image URL to resolve to an
  // absolute one — without this Next.js silently can't build a working
  // preview-card image URL. Every page inherits this baseline; the listing
  // detail page (generateMetadata) overrides title/description/images with
  // the listing's own real photo, everything else keeps this fallback.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: 'Lukka Place',
    locale: 'fr_CD',
    type: 'website',
    // 1200x630, Open Graph's own canonical card size — previously unset
    // entirely, so every link share (WhatsApp, iMessage, Slack, Facebook)
    // rendered with no image at all.
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: SITE_TITLE }],
  },
  twitter: {
    // summary_large_image, not the previous 'summary' — that card type
    // expects a small near-square thumbnail; pairing it with a real 1200x630
    // banner would have X crop it down oddly instead of showing the full
    // wide card the image is actually sized for.
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  // app/favicon.ico and app/icon.png both exist now (both regenerated as
  // the new solid-blue tile — see the doc comment above), but confirmed
  // directly in a real browser: with both special files present, the App
  // Router's auto-convention only emits a <link rel="icon"> for
  // favicon.ico and silently drops icon.png, rather than offering both
  // for the browser to pick from. The explicit `icon` entry below is what
  // actually gets it linked. apple-touch-icon still needs its own explicit
  // entry too — iOS ignores both of the above for a home-screen bookmark.
  icons: {
    icon: '/icon.png',
    apple: '/brand/apple-touch-icon.png',
  },
};

// themeColor lives in `viewport`, not `metadata` — App Router's own split
// since Next 14 (a raw `<meta name="theme-color">` written by hand in the
// JSX below would just duplicate/fight this API rather than replace it).
// This is what colors the browser chrome/status bar on mobile Safari and
// Chrome/Android when the site is open or added to the home screen.
export const viewport = {
  themeColor: '#1D5BD8',
};

/*
 * Deliberately bare. The public site's shell (Header / Footer) lives in
 * app/(site)/layout.js, not here — /admin has its own chrome and was
 * previously rendering it *underneath* the public header because
 * everything nested in this one layout.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={`${plusJakartaSans.variable} ${dmSerifDisplay.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
