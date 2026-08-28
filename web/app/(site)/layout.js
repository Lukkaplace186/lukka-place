import Header from '@/components/Header';
import SiteShell from '@/components/SiteShell';
import Footer from '@/components/Footer';
import { CurrencyRateProvider } from '@/lib/CurrencyRateContext';
import { getCdfRate } from '@/lib/currencyRate';

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
export default async function SiteLayout({ children }) {
  const rate = await getCdfRate();

  return (
    <CurrencyRateProvider rate={rate}>
      <Header />
      <SiteShell>
        <main className="flex-1">{children}</main>
        <Footer />
      </SiteShell>
    </CurrencyRateProvider>
  );
}
