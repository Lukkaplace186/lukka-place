import Link from 'next/link';
import { CurrencyRateProvider } from '@/lib/CurrencyRateContext';
import { getCdfRate } from '@/lib/currencyRate';
import { Wordmark } from '@/components/Brand';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';

/**
 * Chrome for the agent portfolio pages, cloned from web/Design's "Agent
 * Profile" screen — which carries its own slim header and footer and, most
 * visibly, NO left icon rail.
 *
 * That is why /agents lives in its own route group rather than in (site):
 * app/(site)/layout.js mounts Header + SideRail + BottomNav + Footer, and
 * the fixed 76px rail (plus its `lg:pl-[76px]` gutter) is exactly the
 * "side toolbar" the design doesn't have. Route groups don't change URLs,
 * so /agents and /agents/[id] are untouched.
 *
 * CurrencyRateProvider is re-provided here deliberately: it is not
 * inherited from (site), and <Price> silently falls back to a stale default
 * rate without it — the prices would still render, just not at the real
 * admin-maintained rate, which is precisely the kind of quiet wrongness
 * lib/currency.js's doc comment warns about.
 */
export default async function PortfolioLayout({ children }) {
  const rate = await getCdfRate();
  const publishHref = getCentralWhatsAppHref(
    'Bonjour, je souhaite publier un bien sur Lukka Place.',
  );

  return (
    <CurrencyRateProvider rate={rate}>
      <div className="flex min-h-screen flex-col bg-canvas">
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="mx-auto flex h-[4.75rem] max-w-[77.5rem] items-center justify-between gap-6 px-4 sm:px-6">
            <Wordmark />

            <nav className="flex items-center gap-5 text-sm font-semibold text-ink-70 sm:gap-7">
              <Link href="/listings?transaction_type=vente" className="hidden hover:text-ink sm:block">
                Acheter
              </Link>
              <Link href="/listings?transaction_type=location" className="hidden hover:text-ink sm:block">
                Louer
              </Link>
              <Link href="/agents" className="hidden hover:text-ink sm:block">
                Agences
              </Link>
              {publishHref && (
                <a
                  href={publishHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="u-btn-secondary u-press inline-flex h-9 items-center rounded-lg px-4 text-[0.8125rem] font-bold text-ink"
                >
                  Publier un bien
                </a>
              )}
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-line bg-canvas-alt py-8">
          <div className="mx-auto flex max-w-[77.5rem] flex-wrap items-center justify-between gap-4 px-4 text-[0.8125rem] text-ink-45 sm:px-6">
            <span className="inline-flex items-center gap-2.5">
              <Wordmark />
              Portfolio hébergé par Lukka Place
            </span>
            <Link href="/contact" className="hover:text-ink">
              Signaler une annonce
            </Link>
          </div>
        </footer>
      </div>
    </CurrencyRateProvider>
  );
}
