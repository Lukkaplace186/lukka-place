import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import SectionHeading from './SectionHeading';

const VALUE_PROPS = [
  {
    number: '01',
    title: 'Annonces vérifiées',
    body: 'Chaque bien passe par un contrôle humain avant publication — informations, photos et localisation sont revues, pas simplement recopiées.',
  },
  {
    number: '02',
    title: 'Contact direct',
    body: 'Une seule ligne WhatsApp, la même pour toutes les annonces. Pas de formulaire, pas de rappel commercial non sollicité.',
  },
  {
    number: '03',
    title: 'Prix transparents',
    body: 'Prix, superficie et référence affichés tels quels, en dollars comme en francs. Aucun frais de dossier ajouté par la plateforme.',
  },
];

/**
 * Three value props as an editorial numbered row, on the chalk band that
 * closes the homepage before the footer.
 *
 * Two things the refonte changed here, both about where the reader is sent
 * next:
 *
 *   - Left-aligned, not centred. Everything above it — hero, commune row,
 *     listings grid — sits on the container's left edge, and this section
 *     breaking that axis was the only place the page changed alignment
 *     mid-scroll. Centring is for a closing statement, not for a row of
 *     three cards.
 *   - One exit, not three. Each prop used to carry its own CTA ("Voir les
 *     annonces" / "Nous contacter" / "En savoir plus"), which scattered the
 *     reader at exactly the moment the section had finished making its
 *     case. The three claims are now stated, then a single primary button
 *     under the group carries all of them.
 *
 * The three cells are fused into one hairline-ruled band (gap-px over a
 * `bg-line` grid, with a rule top and bottom) rather than three separate
 * floating cards — the copy reads as one argument in three parts, not as
 * three offers.
 *
 * No Buying/Renting/Selling tabs: none of these three differ by transaction
 * type, so tabs would be dead UI.
 */
export default function ValueProposition() {
  return (
    <section className="bg-canvas-alt py-14 shadow-[0_1px_0_var(--line)_inset] sm:py-20">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Notre approche" title="Ce qui change, concrètement" className="mb-10 sm:mb-12" />

        <div className="grid grid-cols-1 gap-px border-y border-line bg-line md:grid-cols-3">
          {VALUE_PROPS.map(({ number, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-3 bg-canvas-alt py-8 sm:py-9 md:px-10 md:first:pl-0 md:last:pr-0"
            >
              <span className="u-tabular font-display text-[2.125rem] font-normal leading-none text-blue">{number}</span>
              {/* Sans 700, not the display serif — the design uses the
                  serif only for the numeral here. */}
              <h3 className="text-[1.3125rem] font-bold leading-snug tracking-[-0.008em] text-ink">{title}</h3>
              <p className="text-[1rem] leading-[1.6] text-ink-70 text-pretty">{body}</p>
            </div>
          ))}
        </div>

        <Link
          href="/listings"
          className="u-press u-btn-primary mt-9 inline-flex h-12 items-center gap-2 rounded-lg bg-blue px-6 text-[1rem] font-semibold text-white"
        >
          Voir les annonces vérifiées
          <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        </Link>
      </div>
    </section>
  );
}
