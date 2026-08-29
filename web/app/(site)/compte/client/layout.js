import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { getPortalCustomer, getPortalCounts } from '@/lib/customerPortal';
import { formatPhoneDisplay } from '@/lib/phone';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import ClientPortalTabs from './ClientPortalTabs';

export const metadata = {
  title: 'Espace client — Lukka Place',
  robots: { index: false, follow: false },
};

/**
 * Espace Client shell — web/Design/Customer dash's "Espace Client" canvas.
 *
 * The design puts the greeting above the tab bar and keeps both on every
 * tab, so both live here rather than being re-declared by seven pages.
 * Each page still guards its own session (a layout is not an authorization
 * boundary you should rely on alone) and still owns its own h2.
 *
 * Ground is `bg-canvas-warm` (#F9F8F6) — the design's own <body> fill for
 * this canvas, and the one surface in this app that isn't white. White
 * cards read as figure against it; that contrast is the whole point of the
 * portal's look and is why the token exists (app/globals.css).
 *
 * The tab bar sticks at `top-16`, under the fixed h-16 Header — the same
 * coupling FilterBar.js already depends on (web/CLAUDE.md's layout notes).
 */
export default async function ClientPortalLayout({ children }) {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client');

  const { customerId, customer } = session;
  const counts = await getPortalCounts(customerId);
  // Favoris+Alertes collapsed into one tab (ClientPortalTabs.js), so its nav
  // pill shows the combined total rather than picking just one of the two
  // real per-metric counts getPortalCounts() already returns.
  const tabCounts = { ...counts, savedTotal: counts.favorites + counts.alerts };

  // The account's own stored name, never a fabricated one. A customer who
  // signed up without giving a name gets their real phone number as the
  // greeting rather than an invented "Bonjour, Client".
  const fullName = (customer.full_name || '').trim();
  const firstName = fullName ? fullName.split(/\s+/)[0] : formatPhoneDisplay(customer.phone);

  return (
    <div className="min-h-screen bg-canvas-warm">
      {/* pt/pb compact on mobile (was a flat pt-11/pb-7 at every width) so
          the tab bar and saved properties sit higher on a phone viewport
          without scrolling past a tall greeting first; desktop keeps the
          original spacing. */}
      <div className="mx-auto max-w-[77.5rem] px-4 pb-4 pt-6 sm:px-6 sm:pb-7 sm:pt-11 lg:px-8">
        <p className="u-eyebrow">Espace client</p>
        <h1 className="mt-2.5 font-display text-[2.125rem] font-normal leading-[1.08] tracking-[-0.012em] text-ink sm:text-[2.875rem]">
          Bonjour, {firstName}
        </h1>
        <p className="mt-3 max-w-[38.75rem] text-[1rem] leading-[1.6] text-ink-45">
          Vos biens sauvegardés, vos alertes et vos échanges avec les agences de Kinshasa, au même endroit.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-blue-deep">
          <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
          {/* The one identity fact this schema actually holds: the account is
              tied to a real phone number. There is no ID-verification column
              on `customers`, so the design's "Compte vérifié / Identité
              vérifiée" badge is deliberately not reproduced as such. */}
          Compte lié au {formatPhoneDisplay(customer.phone)}
        </p>
      </div>

      <ClientPortalTabs counts={tabCounts} />

      <main className="mx-auto max-w-[77.5rem] px-4 pb-24 pt-10 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
