import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { SITE_URL } from '@/lib/constants';
import { getI18n, getT } from '@/lib/i18n/server';
import { getSeoSettings } from '@/lib/siteSettings';
import { seoMetadata } from '@/lib/siteSettingsRules';
import { I18nProvider } from '@/lib/i18n/client';
import LocaleSync from '@/components/LocaleSync';
import { TRANSLATION_DOM_GUARD_SCRIPT } from '@/lib/translationDomGuard';
import OfflineBanner from '@/components/OfflineBanner';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import WebVitals from '@/components/WebVitals';

/*
 * One family. Plus Jakarta Sans carries every title, label, price and line
 * of body copy; hierarchy is size and weight only. Subset to the five
 * weights the type scale uses (400/500/600/700/800) rather than shipping the
 * whole variable range over mobile data.
 *
 * DM Serif Display set page and section titles until 2026-10-24, when the
 * owner found it clashed with the sans labels beside it; it is no longer
 * loaded, which also saves every visitor its font file.
 */
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
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
const OG_IMAGE = '/og-image.png?v=2';

/*
 * generateMetadata rather than a static object: the site title, description
 * and every share-card string below are user-facing copy, and a static export
 * is evaluated once at module load with no access to the request's locale.
 * `openGraph.locale` follows the choice too, so a shared link previews in the
 * language the sharer was reading.
 *
 * The title, description and share image can be set on /admin/cms
 * ("Optimisation SEO & Meta", cms_settings `site.seo`, lib/siteSettings.js);
 * an empty field keeps the dictionary's text and the built-in card. These are
 * the defaults only: a page's own generateMetadata (listings, landing pages,
 * guides…) replaces them. getSeoSettings never throws.
 */
export async function generateMetadata() {
  const t = await getT();
  const seo = await getSeoSettings();
  const defaults = seoMetadata(seo, t.locale, { title: t('site.metaTitle'), description: t('site.metaDescription') });
  const SITE_TITLE = defaults.title;
  const SITE_DESCRIPTION = defaults.description;
  const locale = t.locale === 'en' ? 'en_GB' : 'fr_CD';
  // A console image's size is unknown, so it is announced without dimensions.
  const ogImages = defaults.image
    ? [{ url: defaults.image, alt: SITE_TITLE }]
    : [{ url: OG_IMAGE, width: 1200, height: 630, alt: SITE_TITLE }];

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
      images: ogImages,
    },
    twitter: {
      // summary_large_image, not the previous 'summary' — that card type
      // expects a small near-square thumbnail; pairing it with a real 1200x630
      // banner would have X crop it down oddly instead of showing the full
      // wide card the image is actually sized for.
      card: 'summary_large_image',
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [defaults.image || OG_IMAGE],
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
    // Search Console / Bing Webmaster ownership, pasted into .env.local:
    // GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION (the token only, not
    // the whole <meta> tag). Absent = no tag, e.g. when verified by DNS.
    verification: {
      ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
      ...(process.env.BING_SITE_VERIFICATION ? { other: { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } } : {}),
    },
  };
}

// themeColor lives in `viewport`, not `metadata` — App Router's own split
// since Next 14 (a raw `<meta name="theme-color">` written by hand in the
// JSX below would just duplicate/fight this API rather than replace it).
// This is what colors the browser chrome/status bar on mobile Safari and
// Chrome/Android when the site is open or added to the home screen.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the page use the full screen on notched phones; the bottom bars
  // already pad with env(safe-area-inset-bottom). No maximumScale on purpose —
  // see the 16px field rule in globals.css for how input zoom is prevented.
  viewportFit: 'cover',
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
    <html lang={locale} className={`${plusJakartaSans.variable} h-full`}>
      <body className="min-h-full">
        {/*
         * Must run before React's first commit, and hydration is one. Browser
         * page translation (Edge, Chrome, Google Translate) swaps React's text
         * nodes for <font> wrappers; the next commit's removeChild then throws
         * and the whole route falls to "This page couldn't load" — reported on
         * the agent dashboard's Visites tab. beforeInteractive inlines it into
         * the initial HTML, so it runs while the document is parsed and before
         * hydration — the moment that matters. It lands after the chunk
         * <script> tags in <head>, which is fine: React DOM looks removeChild
         * up on the node at call time. afterInteractive would install it too
         * late. See lib/translationDomGuard.js.
         */}
        <Script
          id="translation-dom-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: TRANSLATION_DOM_GUARD_SCRIPT }}
        />
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
          {/* Mobile resilience and measurement, on every surface: the offline
              pill, the service worker (public/sw.js) and real-user Web
              Vitals (/api/telemetry/vitals). Each renders nothing. */}
          <OfflineBanner />
          <ServiceWorkerRegister />
          <WebVitals />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
