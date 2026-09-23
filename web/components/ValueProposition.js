import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

// Keys, not text — see components/navItems.js on why a module-level constant
// cannot hold translated copy.
const VALUE_PROPS = [
  { id: 'verified', titleKey: 'home.value.verifiedTitle', bodyKey: 'home.value.verifiedBody' },
  { id: 'contact', titleKey: 'home.value.contactTitle', bodyKey: 'home.value.contactBody' },
  { id: 'prices', titleKey: 'home.value.pricesTitle', bodyKey: 'home.value.pricesBody' },
];

/**
 * Three value props as an editorial row, on the chalk band that closes the
 * homepage before the footer.
 *
 * No "01/02/03" numerals. They were decoration, not information: the three
 * claims are peers, not an ordered procedure, so numbering them implied a
 * sequence the copy does not have — and on mobile, where the three cells
 * stack, each 34px serif numeral pushed the actual heading a full line
 * further down the fold for no gain. The heading is now the first thing in
 * every cell, on the same left axis as its body text.
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
export default async function ValueProposition() {
  const t = await getT();
  return (
    /* White, not --canvas-alt. This band was #f7f7f5 against a #ffffff
       listings section above it — a 1.5% difference in lightness, which
       read as neither one ground nor two. With the storefront settled on
       prestige white throughout, the honest version is a single ground and
       a real rule: the inset top hairline is now the only thing separating
       this section from the listings, and it does the job that the
       almost-invisible fill was pretending to. */
    /* Asymmetric padding, deliberately: the top is roughly half the bottom.
       The dead white space reported above this section's kicker was two
       paddings stacked — the listings section's own pb plus this one's pt
       — which came to 100px on a phone and 176px on desktop with nothing
       in it. The hairline above already marks the break, so the label does
       not need to be pushed away from it; the bottom keeps its old
       generosity because the footer's royal band follows and wants the
       air. Trimmed alongside the listings sections' pb, which owns the
       other half of that gap — measured on a phone rather than guessed:
       card bottom to hairline was 32px, hairline to label 24px, with the
       carousel's own 16px scrollbar padding inside that again. */
    <section className="bg-canvas pt-4 pb-11 shadow-[0_1px_0_var(--line)_inset] sm:pt-7 sm:pb-20">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        {/* The eyebrow IS the header. It previously sat above a serif title
            ("Ce qui change, concrètement" / "What actually changes") that
            restated the same promise the three numbered props then make in
            full — a label, a paraphrase of the section, and the section
            itself, in that order. The label is kept because it names the
            section in the page outline; the paraphrase is gone. */}
        <h2 className="u-reveal-in-view u-eyebrow u-eyebrow-section mb-5 sm:mb-9">{t('home.value.eyebrow')}</h2>

        <div className="u-stagger-in-view-inner grid grid-cols-1 gap-px border-y border-line bg-line md:grid-cols-3">
          {VALUE_PROPS.map(({ id, titleKey, bodyKey }) => (
            <div
              key={id}
              /* Matches the section fill above, and must: these cells sit on
                 a `bg-line` grid with a 1px gap, so the hairlines ARE the
                 gap showing through. A cell filled with anything other than
                 the section's own ground draws three visible blocks instead
                 of one ruled band. */
              className="flex flex-col gap-2 bg-canvas py-6 sm:gap-2.5 sm:py-9 md:px-10 md:first:pl-0 md:last:pr-0"
            >
              {/* Sans 700, not the display serif: with the numeral gone the
                  serif has no role in this section at all. */}
              <h3 className="text-[1.3125rem] font-bold leading-snug tracking-[-0.008em] text-ink">{t(titleKey)}</h3>
              <p className="text-[1rem] leading-[1.6] text-ink-70 text-pretty">{t(bodyKey)}</p>
            </div>
          ))}
        </div>

        <Link
          href="/listings"
          className="u-press u-btn-primary mt-7 inline-flex h-12 items-center gap-2 rounded-lg bg-blue px-6 text-[1rem] font-semibold text-white sm:mt-9"
        >
          {t('listings.viewVerified')}
          <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        </Link>
      </div>
    </section>
  );
}
