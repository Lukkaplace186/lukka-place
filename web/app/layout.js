import { Plus_Jakarta_Sans, DM_Serif_Display } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { SITE_URL } from '@/lib/constants';
import { getI18n, getT } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';
import LocaleSync from '@/components/LocaleSync';

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


// Real brand asset: public/brand/logo-dark.png (the client-supplied white
// wordmark, alpha-transparent — see Brand.js's own doc comment) composited
// onto a solid #1D5BD8 fill, at the three sizes each surface actually
// needs. Not a placeholder or a re-drawn logo — same lockup pixels the
// header/footer already render, just given a real background instead of
// transparency for the surfaces (favicon tiles, share-card previews) that
// need one. Regenerate by re-running the compositing script (sharp is
// already a project dependency) if the source lockup ever changes.
const OG_IMAGE = '/og-image.png';

/*
 * generateMetadata rather than a static object: the site title, description
 * and every share-card string below are user-facing copy, and a static export
 * is evaluated once at module load with no access to the request's locale.
 * `openGraph.locale` follows the choice too, so a shared link previews in the
 * language the sharer was reading.
 */
export async function generateMetadata() {
  const t = await getT();
  const SITE_TITLE = t('site.metaTitle');
  const SITE_DESCRIPTION = t('site.metaDescription');
  const locale = t.locale === 'en' ? 'en_GB' : 'fr_CD';

  return {
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
      siteName: t('footer.columns.brand'),
      locale,
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
}

// themeColor lives in `viewport`, not `metadata` — App Router's own split
// since Next 14 (a raw `<meta name="theme-color">` written by hand in the
// JSX below would just duplicate/fight this API rather than replace it).
// This is what colors the browser chrome/status bar on mobile Safari and
// Chrome/Android when the site is open or added to the home screen.
export const viewport = {
  themeColor: '#1D5BD8',
};

/*
 * The namespaces every surface shares — the header, the footer, the sidebars
 * and the generic Save/Cancel/Delete vocabulary. Each of the four surface
 * layouts adds its own on top (I18nProvider merges rather than replaces, see
 * lib/i18n/client.js), so /admin's copy never ships to a public visitor and
 * the storefront's listing vocabulary never ships to /admin.
 */
const CHROME_NAMESPACES = ['common', 'nav', 'footer'];

/*
 * Deliberately bare. The public site's shell (Header / Footer) lives in
 * app/(site)/layout.js, not here — /admin has its own chrome and was
 * previously rendering it *underneath* the public header because
 * everything nested in this one layout.
 *
 * The one thing that IS global is locale: `lang` on <html> has to be the
 * real language of the document (screen readers pick pronunciation from it,
 * and so does Chrome's translate prompt), and every surface below needs a
 * provider. Reading the cookie here is what makes this layout — and so every
 * route — dynamic; see lib/i18n/config.js for why that trade-off was taken
 * over restructuring the app into app/[locale]/.
 */
export default async function RootLayout({ children }) {
  const { locale, messages } = await getI18n(CHROME_NAMESPACES);

  return (
    <html lang={locale} className={`${plusJakartaSans.variable} ${dmSerifDisplay.variable} h-full`}>
      <body className="min-h-full">
        {/*
         * Plausible — cookieless, privacy-friendly page analytics.
         *
         * Deliberately additive to lib/analytics.js + /api/track, not a
         * replacement: that one is our own first-party counter (per-listing
         * views and enquiries, feeding /admin/dashboard) and answers "which
         * listing is working". Plausible answers "where does traffic come
         * from". Neither can be derived from the other.
         *
         * `afterInteractive` rather than `beforeInteractive`: Next only
         * honours beforeInteractive by injecting into <head> and blocking the
         * initial HTML, and an analytics beacon is never worth delaying first
         * paint for. That is safe here precisely because the inline stub below
         * is Plausible's own queue shim — any plausible(...) call made before
         * the remote script lands is buffered on `plausible.q` and replayed,
         * rather than thrown away.
         *
         * The id in the script URL is a public site identifier (it ships to
         * every browser by definition), not a secret, so it is hardcoded
         * rather than put behind a NEXT_PUBLIC_ env var that would add a
         * deploy-time failure mode for no confidentiality gain.
         */}
        <Script
          src="https://plausible.io/js/pa-9NscHR8kDkD908gAxBxEC.js"
          strategy="afterInteractive"
        />
        <Script id="plausible-init" strategy="afterInteractive">
          {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
plausible.init()`}
        </Script>
        <I18nProvider locale={locale} messages={messages}>
          <LocaleSync />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
