import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Shared breadcrumb. The last entry renders as plain text, never a link to
 * the page you are already on.
 *
 * @param {{items: Array<{label: string, href?: string}>}} props
 */
export default function Breadcrumb({ items, className = '' }) {
  return (
    <nav aria-label="Fil d'Ariane" className={`flex flex-wrap items-center gap-1 text-[0.75rem] text-ink-45 ${className}`}>
      {items.map(({ label, href }, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${label}-${i}`} className="inline-flex min-w-0 items-center gap-1">
            {i > 0 ? (
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-3 w-3 shrink-0 text-ink-25" />
            ) : null}
            {isLast || !href ? (
              <span className="truncate text-ink-70">{label}</span>
            ) : (
              <Link href={href} className="transition-colors hover:text-blue-deep">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
