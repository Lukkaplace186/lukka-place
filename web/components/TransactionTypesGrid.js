import Link from 'next/link';
import { Home, KeyRound, Megaphone } from 'lucide-react';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const CARDS = [
  {
    icon: KeyRound,
    title: 'Louer',
    body: 'Appartements et maisons à louer, vérifiés et prêts à visiter.',
    ctaLabel: 'Biens à louer',
    href: '/listings?transaction_type=location',
  },
  {
    icon: Home,
    title: 'Acheter',
    body: 'Appartements, villas et parcelles à vendre à Kinshasa.',
    ctaLabel: 'Biens à vendre',
    href: '/listings?transaction_type=vente',
  },
  {
    icon: Megaphone,
    title: 'Vendre',
    body: 'Un bien à publier ? Notre équipe s\u2019en occupe depuis WhatsApp.',
    ctaLabel: 'Lister mon bien',
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
export default function TransactionTypesGrid() {
  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const sellHref = phoneNumber
    ? buildWhatsAppLink(phoneNumber, 'Bonjour, je souhaite lister mon bien sur Lukka Place.')
    : null;

  return (
    <section className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
      <div className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {CARDS.map(({ icon: Icon, title, body, ctaLabel, href, whatsapp }) => {
          const resolvedHref = whatsapp ? sellHref : href;
          const disabled = whatsapp && !sellHref;

          const label = disabled ? (
            <span className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-ink-25">{ctaLabel}</span>
          ) : (
            <span className="group inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-blue-deep">
              {ctaLabel}
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
              <h3 className="font-display text-xl leading-tight tracking-[-0.01em] text-ink">{title}</h3>
              <p className="mb-6 mt-2 text-[0.875rem] leading-relaxed text-ink-45">{body}</p>
              <span className="mt-auto">{label}</span>
            </>
          );

          const shell = 'flex flex-col p-7 transition-colors hover:bg-canvas-alt sm:p-8';

          if (disabled) {
            return (
              <div key={title} className={shell}>
                {inner}
              </div>
            );
          }

          return whatsapp ? (
            <a key={title} href={resolvedHref} target="_blank" rel="noopener noreferrer" className={shell}>
              {inner}
            </a>
          ) : (
            <Link key={title} href={resolvedHref} className={shell}>
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
