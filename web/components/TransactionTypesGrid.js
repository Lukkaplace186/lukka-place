import Link from 'next/link';
import { Home, KeyRound, Megaphone } from 'lucide-react';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

const CARDS = [
  {
    icon: KeyRound,
    titleKey: 'home.transactions.rentTitle',
    bodyKey: 'home.transactions.rentBody',
    ctaKey: 'listings.sidebar.propertiesToRent',
    href: '/listings?transaction_type=location',
  },
  {
    icon: Home,
    titleKey: 'home.transactions.buyTitle',
    bodyKey: 'home.transactions.buyBody',
    ctaKey: 'home.transactions.buyCta',
    href: '/listings?transaction_type=vente',
  },
  {
    icon: Megaphone,
    titleKey: 'home.transactions.sellTitle',
    bodyKey: 'home.transactions.sellBody',
    ctaKey: 'home.transactions.sellCta',
    whatsapp: true,
  },
];

/**
 * Three primary entry points. "Louer"/"Acheter" route to real filtered
 * searches on the same transaction_type param the rest of the site uses.
 *
 * "Vendre" is deliberately not a submission form — no such form exists;
 * agents submit through WhatsApp to the intake engine (see root CLAUDE.md),
 * so this opens the same real central number as every other CTA, and renders
 * as a non-clickable state when no number is configured rather than shipping
 * a dead link.
 */
export default async function TransactionTypesGrid() {
  const t = await getT();
  const sellHref = getCentralWhatsAppHref('Bonjour, je souhaite lister mon bien sur Lukka Place.');

  return (
    <section className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
      <div className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {CARDS.map(({ icon: Icon, titleKey, bodyKey, ctaKey, href, whatsapp }) => {
          const resolvedHref = whatsapp ? sellHref : href;
          const disabled = whatsapp && !sellHref;

          const label = disabled ? (
            <span className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-ink-25">{t(ctaKey)}</span>
          ) : (
            <span className="group inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-blue-deep">
              {t(ctaKey)}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                &rarr;
              </span>
            </span>
          );

          const inner = (
            <>
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
                <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
              </span>
              <h3 className="font-display text-xl leading-tight tracking-[-0.01em] text-ink">{t(titleKey)}</h3>
              <p className="mb-6 mt-2 text-[0.875rem] leading-relaxed text-ink-45">{t(bodyKey)}</p>
              <span className="mt-auto">{label}</span>
            </>
          );

          const shell = 'flex flex-col p-7 transition-colors hover:bg-canvas-alt sm:p-8';

          if (disabled) {
            return (
              <div key={titleKey} className={shell}>
                {inner}
              </div>
            );
          }

          return whatsapp ? (
            <a key={titleKey} href={resolvedHref} target="_blank" rel="noopener noreferrer" className={shell}>
              {inner}
            </a>
          ) : (
            <Link key={titleKey} href={resolvedHref} className={shell}>
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
