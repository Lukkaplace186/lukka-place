import Link from '@/components/LocaleLink';
import { ArrowRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * One section style for the homepage below the search (2026-11-04 landing
 * pass, from the approved "landing below the search" mockup): every band
 * opens with the same title on the left and, when there is somewhere to go,
 * the same sentence-case link with an arrow on the right. No eyebrow above
 * the title — the page used to mix "NOUVEAUTÉS" / "VOTRE HISTORIQUE"
 * kickers with bare titles, which is part of what made it read as busy.
 *
 * HOME_SECTION is the band's container, so every section has the same width,
 * gutters and vertical rhythm. Sections are told apart by their ground
 * (white, the royal alert band, the chalk market band), never by a border.
 */
// Half the vertical rhythm it had on a phone (py-10 → py-6, owner
// 2026-11-18: a shorter, smoother landing page, as on the listing page).
export const HOME_SECTION = 'mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10';

export default function HomeSectionHeader({ title, href, linkLabel, className = '' }) {
  return (
    <div className={`mb-4 flex items-end justify-between gap-4 sm:mb-5 ${className}`}>
      <h2 className="u-title-storefront min-w-0 text-ink">{title}</h2>
      {href && linkLabel ? (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1.5 text-[0.875rem] font-semibold text-blue-deep hover:text-ink"
        >
          {linkLabel}
          <ArrowRight
            strokeWidth={ICON_STROKE_WIDTH}
            aria-hidden="true"
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}
    </div>
  );
}
