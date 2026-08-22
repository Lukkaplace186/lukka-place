import Link from 'next/link';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import SectionHeading from './SectionHeading';

const VALUE_PROPS = [
  {
    number: '01',
    title: 'Annonces vérifiées',
    body: 'Chaque bien passe par un contrôle humain avant publication — informations, photos et localisation sont revues, pas simplement recopiées.',
    ctaLabel: 'Voir les annonces',
    ctaHref: '/listings',
  },
  {
    number: '02',
    title: 'Contact direct',
    body: 'Une seule ligne WhatsApp, la même pour toutes les annonces. Pas de formulaire, pas de rappel commercial non sollicité.',
    ctaLabel: 'Nous contacter',
    whatsapp: true,
  },
  {
    number: '03',
    title: 'Prix transparents',
    body: 'Prix, superficie et référence affichés tels quels, en dollars comme en francs. Aucun frais de dossier ajouté par la plateforme.',
    ctaLabel: 'En savoir plus',
    ctaHref: '/a-propos',
  },
];

/**
 * Three value props as an editorial numbered row.
 *
 * No Buying/Renting/Selling tabs: none of these three differ by transaction
 * type, so tabs would be dead UI. The WhatsApp CTA follows the same
 * central-number / renders-inert-when-unset pattern as every other WhatsApp
 * entry point on the site.
 */
export default function ValueProposition() {
  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const whatsappHref = phoneNumber
    ? buildWhatsAppLink(phoneNumber, 'Bonjour, je vous contacte depuis lukkaplace.com.')
    : null;

  const linkClass =
    'group mt-6 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-blue-deep';

  return (
    <section className="border-y border-line bg-canvas-alt py-20 sm:py-28">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Notre approche" title="Ce qui change, concrètement" align="center" className="mb-14" />

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
          {VALUE_PROPS.map(({ number, title, body, ctaLabel, ctaHref, whatsapp }) => (
            <div key={title} className="flex flex-col bg-surface p-7 sm:p-9">
              <span className="u-tabular font-display text-2xl font-normal text-blue">{number}</span>
              <h3 className="mt-5 font-display text-xl leading-tight tracking-[-0.01em] text-ink">{title}</h3>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-ink-45">{body}</p>

              {whatsapp ? (
                whatsappHref ? (
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    {ctaLabel}
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                      &rarr;
                    </span>
                  </a>
                ) : (
                  <span className="mt-6 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-ink-25">
                    {ctaLabel}
                  </span>
                )
              ) : (
                <Link href={ctaHref} className={linkClass}>
                  {ctaLabel}
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                    &rarr;
                  </span>
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
