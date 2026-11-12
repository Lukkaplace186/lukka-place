import { Suspense } from 'react';
import Header from '@/components/Header';
import { getFeatureFlags, getGrowthSettings } from '@/lib/siteSettings';
import AdTracking from '@/components/AdTracking';
import SitePageViewTracker from '@/components/SitePageViewTracker';
import SignupNudge from '@/components/SignupNudge';
import SiteShell from '@/components/SiteShell';
import Footer from '@/components/Footer';
import AppTabBar from '@/components/AppTabBar';
import AppTopBar from '@/components/app/AppTopBar';
import AppMotion from '@/components/app/AppMotion';
import AppPullToRefresh from '@/components/app/AppPullToRefresh';
import { isAppRequest } from '@/lib/appMode';
import FavoriteResumeHandler from '@/components/FavoriteResumeHandler';
import AccountLimitNotice from '@/components/AccountLimitNotice';
import VisitCartMount from '@/components/VisitCartMount';
import ImpersonationBanner from '@/components/ImpersonationBanner';
import { CurrencyRateProvider } from '@/lib/CurrencyRateContext';
import { getCdfRate } from '@/lib/currencyRate';
import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

/**
 * Public site shell.
 *
 * This lives in the (site) route group rather than the root layout because
 * /admin has its own chrome and used to render it *underneath* the public
 * header, footer and bottom nav — everything nested in one root layout.
 * Route groups don't affect URLs, so every public path is unchanged.
 *
 * Spacing contract, defined here once so pages don't each reinvent it:
 *   pt-16   clears the fixed h-16 Header
 *
 * There used to be two more lines here. `lg:pl-[76px]` cleared a fixed
 * desktop icon rail (SideRail.js) — removed entirely, since web/Design's
 * screens never carried a left toolbar. `pb-16 lg:pb-0` cleared
 * BottomNav.js, the fixed mobile tab bar (Rechercher/Favoris/Demandes/
 * Compte) — also removed entirely now, per an explicit instruction to drop
 * the persistent bottom bar in favour of Header's own hamburger menu +
 * top-right utility row on mobile (the same Rightmove-style pattern this
 * whole nav rework has been chasing: no persistent bottom chrome, floating
 * per-page actions instead — see MobileListingBar.js, repositioned to the
 * true viewport bottom now that there's nothing there to clear.
 * FloatingControlBar.js, the one other component that got the same
 * repositioning at the time, has since been removed entirely on a later
 * instruction — its two actions ("Carte", "Trier") both moved into
 * in-page chrome instead (FilterBar.js's mobile utility row, and
 * ResultsHeader.js next to the result count) rather than floating over
 * the feed. Every page under this layout gets its full container height
 * back rather than losing 64px to a bar with nothing forcing it.
 *
 * Fetches the real, admin-editable exchange rate once per request here
 * (a server-only DB read — see lib/currencyRate.js) and provides it to every
 * client component under this layout via CurrencyRateProvider, since Price.js
 * and PropertyMap.js are 'use client' and can't read Postgres directly.
 */
/*
 * The storefront's own namespaces, added on top of the chrome ones the root
 * layout already supplies (I18nProvider merges — see lib/i18n/client.js).
 * /admin and the agent dashboard sit outside this route group and add their
 * own instead, which is what keeps admin copy out of a public visitor's
 * payload.
 */
const SITE_NAMESPACES = [
  'appShell', 'home', 'about', 'contact', 'breadcrumb', 'listings', 'enquiry', 'account', 'search', 'auth', 'updates', 'chat',
];
// `projects` ships from app/(site)/projets/layout.js only.

export default async function SiteLayout({ children }) {
  const rate = await getCdfRate();
  const { locale, messages } = await getI18n(SITE_NAMESPACES);
  const [features, growth, app] = await Promise.all([getFeatureFlags(), getGrowthSettings(), isAppRequest()]);

  // Inside the store app (lib/appModeRules.js): the app's top bar and tab bar
  // instead of the website's header and footer, the motion provider, and the
  // display serif. The website is drawn exactly as before.
  const Chrome = app ? AppMotion : Passthrough;

  return (
    <I18nProvider locale={locale} messages={messages}>
      <Chrome>
      {/* display: contents on the website: no box, so its layout is untouched. */}
      <div className={app ? 'min-h-screen bg-canvas-alt' : 'contents'}>
      <CurrencyRateProvider rate={rate}>
        <FavoriteResumeHandler />
        <AccountLimitNotice />
        <VisitCartMount />
        {/* The app's list screens refresh on a pull down (a WebView has no such gesture of its own). */}
        {app ? <AppPullToRefresh /> : null}
        {app ? (
          <AppTopBar />
        ) : (
          <Header hiddenHrefs={[...(features.publicProjects ? [] : ['/projets']), ...(features.publicBlog ? [] : ['/guides'])]} />
        )}
        <SiteShell>
          {/* min-h-0 alongside flex-1: a flex item's default min-height is
              `auto` (its content size), not 0 — the standard real fix for the
              other well-documented trigger of WebKit's sticky-inside-flex bug
              class (see FilterBar.js's own doc comment for the specific
              symptom this app hit). Purely defensive: it doesn't change any
              visible sizing here since content already determines this
              column's height. */}
          <main className="min-h-0 flex-1">{children}</main>
          {/* Inside the store app: the tab bar instead of the footer (lib/appModeRules.js). */}
          {app ? (
            <Suspense fallback={null}>
              <AppTabBar />
            </Suspense>
          ) : (
            <Footer />
          )}
        </SiteShell>
        <ImpersonationBanner />
        {/* Meta / TikTok pixels, and the consent banner in Europe (lib/adTrackingRules.js). */}
        <AdTracking metaPixelId={growth.metaPixelId} tiktokPixelId={growth.tiktokPixelId} />
        {/* Our own page_view on every page but a listing's (that one sends its own). */}
        <SitePageViewTracker />
        {/* "Créez un compte…" at the right moments (growth plan item 24). */}
        <SignupNudge />
      </CurrencyRateProvider>
      </div>
      </Chrome>
    </I18nProvider>
  );
}

function Passthrough({ children }) {
  return children;
}
