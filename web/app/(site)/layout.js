import Header from '@/components/Header';
import SideRail from '@/components/SideRail';
import Footer from '@/components/Footer';
import BottomNav from '@/components/BottomNav';
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
 *   pt-16          clears the fixed h-16 Header
 *   lg:pl-[76px]   clears the fixed SideRail
 *   pb-16 lg:pb-0  clears the fixed BottomNav (which is lg:hidden)
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
      <SideRail />
      <div className="flex min-h-screen flex-col pt-16 lg:pl-[76px]">
        <main className="flex-1 pb-16 lg:pb-0">{children}</main>
        <Footer />
      </div>
      <BottomNav />
    </CurrencyRateProvider>
  );
}
