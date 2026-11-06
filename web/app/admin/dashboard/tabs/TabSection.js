import Link from 'next/link';

/**
 * One band of a dashboard tab: a section title, an optional one-line note,
 * and a "see all" link to the paginated page where the full table lives.
 * The dashboard previews; the section pages own pagination.
 */
export default function TabSection({ id, title, note, href, linkLabel, children }) {
  return (
    <section id={id} className="mt-8 scroll-mt-24 first:mt-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="u-title-section text-ink">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm font-medium text-blue hover:underline">
            {linkLabel} →
          </Link>
        ) : null}
      </div>
      {note ? <p className="mb-4 max-w-3xl text-sm text-ink-45">{note}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

/** The table look every dashboard preview shares. */
export const TH = 'px-4 py-2.5 font-semibold';
export const TD = 'px-4 py-2.5';
export const THEAD = 'border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45';
export const TR = 'border-b border-line last:border-b-0';
