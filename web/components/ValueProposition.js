import Link from 'next/link';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
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
  const whatsappHref = getCentralWhatsAppHref('Bonjour, je vous contacte depuis lukkaplace.com.');

  const linkClass =
    'group mt-6 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-blue-deep';

  return (
    // Chalk band with an inset top hairline, 56px vertical padding — the
    // design's own "approach" section, and the last thing on the homepage
    // before the footer.
    <section className="bg-canvas-alt py-14 shadow-[0_1px_0_var(--line)_inset] sm:py-16">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Notre approche" title="Ce qui change, concrètement" align="center" className="mb-9" />

        {/* Three separate hairline cards with a real 24px gap, not one fused
            gap-px grid — the design shows them as distinct cards. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {VALUE_PROPS.map(({ number, title, body, ctaLabel, ctaHref, whatsapp }) => (
            <div key={title} className="u-card flex flex-col rounded-card bg-surface p-7">
              <span className="u-tabular font-display text-[1.625rem] font-normal leading-none text-blue">{number}</span>
              {/* Sans 700 at h4, not the display serif — the design uses the
                  serif only for the numeral here. */}
              <h3 className="mt-3 text-[1.125rem] font-bold leading-snug text-ink">{title}</h3>
              <p className="mt-3 text-[0.875rem] leading-[1.55] text-ink-45">{body}</p>

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
