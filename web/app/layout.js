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
  },
  twitter: {
    card: 'summary',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  // app/favicon.ico is picked up automatically by the App Router's static
  // metadata convention; apple-touch-icon is the one variant that needs an
  // explicit link (iOS ignores favicon.ico for home-screen bookmarks).
  icons: {
    apple: '/brand/apple-touch-icon.png',
  },
};

/*
 * Deliberately bare. The public site's shell (Header / SideRail / Footer /
 * BottomNav) lives in app/(site)/layout.js, not here — /admin has its own
 * chrome and was previously rendering it *underneath* the public header
 * because everything nested in this one layout.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={`${plusJakartaSans.variable} ${dmSerifDisplay.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
