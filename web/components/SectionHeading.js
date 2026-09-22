import Link from 'next/link';

/**
 * Shared section header: eyebrow, serif title, optional lead, optional link.
 *
 * This is where Fraunces earns its place — section titles are the one part
 * of the page that is editorial rather than functional, so they carry the
 * serif while every price, filter and spec stays on the sans face. Holding the
 * weight at 400 is deliberate: the previous design set a display serif at
 * font-extrabold, which is the heaviest cut of a face whose whole character
 * lives at regular weight.
 */
export default function SectionHeading({ eyebrow, title, lead, href, linkLabel = 'Voir tout', align = 'left', className = '', eyebrowClassName = '' }) {
  const centered = align === 'center';

  return (
    <div
      className={`flex flex-col gap-4 sm:flex-row sm:items-end ${centered ? 'sm:justify-center' : 'sm:justify-between'} ${className}`}
    >
      <div className={`max-w-2xl ${centered ? 'mx-auto text-center' : ''}`}>
        {/* `eyebrowClassName` exists for the homepage's brass kicker
            (.u-eyebrow-accent). Both classes are our own utilities rather
            than Tailwind ones, so there is nothing for tailwind-merge to
            resolve between them and plain concatenation is correct here. */}
        {eyebrow && <p className={`u-eyebrow mb-3 ${eyebrowClassName}`}>{eyebrow}</p>}
        <h2 className="font-display text-[1.375rem] font-normal leading-[1.2] tracking-[0.1px] text-ink sm:text-2xl">
          {title}
        </h2>
        {lead && <p className="u-body mt-3 text-ink-45">{lead}</p>}
      </div>

      {href && (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-blue-deep"
        >
          {linkLabel}
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
            &rarr;
          </span>
        </Link>
      )}
    </div>
  );
}
