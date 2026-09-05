import Link from 'next/link';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The handful of shapes every Espace Client page repeats — the design's
 * white panel, its section heading pair, its status badge and its empty
 * state. Extracted so seven pages don't each re-declare the same card
 * chrome and drift (the same reason lib/listingView.js exists).
 *
 * Card chrome is `.u-card` (globals.css): a 1px inset hairline, no visible
 * border, 14px radius — exactly what the design's own panels use
 * (`box-shadow:var(--hairline);border-radius:var(--radius-card)`), and the
 * house rule for cards in this app. `bg-surface` on `bg-canvas-warm` is the
 * figure/ground pair the portal is built on.
 */

export function PortalPanel({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag className={cn('u-card rounded-card bg-surface', className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * The design's page-section header: a DM Serif display title over a muted
 * one-line lead, with an optional action pinned to the right.
 */
export function PortalSectionHeading({ title, lead, action, className = '' }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-6', className)}>
      <div>
        <h2 className="u-title-page text-ink">
          {title}
        </h2>
        {lead ? <p className="mt-2 text-[0.875rem] leading-[1.55] text-ink-45">{lead}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const BADGE_TONES = {
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  royal: 'bg-blue-tint text-blue-deep',
  neutral: 'bg-canvas-deep text-ink-45',
};

/**
 * The design's Badge — an uppercase micro-caps status stamp. Deliberately
 * not the same thing as `.u-tag` (the sentence-case descriptive chip); the
 * design system's readme is explicit that the two are not interchangeable.
 */
export function PortalBadge({ tone = 'neutral', className = '', children }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase leading-none tracking-[0.08em]',
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Honest absence, in the shape the rest of this app already uses
 * (/compte/alertes, /compte/demandes): an icon medallion, a display-face
 * title, one explanatory line, and a real next step — never a fabricated
 * placeholder row.
 */
export function PortalEmpty({ icon: Icon, title, children, actionLabel, actionHref, className = '' }) {
  return (
    <PortalPanel className={cn('px-6 py-14 text-center', className)}>
      {Icon ? (
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-deep text-ink-45">
          <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <h3 className="u-title-section text-ink">{title}</h3>
      {children ? (
        <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">{children}</p>
      ) : null}
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="u-btn-primary mt-7 inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white"
        >
          {actionLabel}
        </Link>
      ) : null}
    </PortalPanel>
  );
}
