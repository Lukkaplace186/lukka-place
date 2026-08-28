import Breadcrumb from './Breadcrumb';

/**
 * Shared editorial shell for the site's short content pages (/a-propos,
 * /contact, /messages, /mises-a-jour, /plan).
 *
 * These were five near-identical hand-rolled layouts that had drifted apart
 * in width, spacing and heading treatment, which is most of why they read as
 * unfinished next to the rest of the site. Two of them are still honest
 * stubs — better dressed, not filled with invented content.
 */
export default function PageShell({ eyebrow, title, lead, breadcrumb, align = 'left', children }) {
  const centered = align === 'center';

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      {breadcrumb ? <Breadcrumb className="mb-8" items={breadcrumb} /> : null}

      <header className={centered ? 'text-center' : ''}>
        {eyebrow ? <p className="u-eyebrow mb-4">{eyebrow}</p> : null}
        <h1 className="font-display text-[2rem] font-normal leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.5rem]">
          {title}
        </h1>
        {lead ? <p className="mt-4 text-[1.0625rem] leading-relaxed text-ink-45">{lead}</p> : null}
      </header>

      <div className={`mt-10 ${centered ? 'text-center' : ''}`}>{children}</div>
    </div>
  );
}

/** Primary action used by the stub pages. */
export function PageAction({ href, children, external = false, tone = 'solid' }) {
  const className =
    tone === 'solid'
      ? 'inline-flex items-center gap-2 rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary'
      : 'inline-flex items-center gap-2 rounded-full bg-green px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-deep';

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** Honest "not built yet" note — never dressed up as a feature. */
export function PageNotice({ children }) {
  return (
    <p className="rounded-lg border border-line bg-canvas-alt px-5 py-4 text-[0.875rem] leading-relaxed text-ink-45">
      {children}
    </p>
  );
}
