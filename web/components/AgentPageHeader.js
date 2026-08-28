import Link from 'next/link';
import { Search, Bell } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The design's 76px sticky dashboard header: page title in DM Serif at
 * 30px, then a search field, a notification bell and the primary action,
 * right-aligned.
 *
 * Both of the design's "chrome" controls are wired to something real
 * rather than being decorative:
 *  - The search box is a plain GET form that re-renders the current
 *    section filtered (`?q=`), so it only appears on the two sections that
 *    genuinely have something to search — Mes biens and Demandes. Pages
 *    that pass no `searchAction` render no box at all rather than an input
 *    that does nothing.
 *  - The bell links to the real new-lead queue (`/demandes?status=NEW`)
 *    and carries a real count. There is no notification *system* on this
 *    app, and this does not pretend there is one: it is a live count of
 *    real unworked leads, which is the only thing a bell here could
 *    honestly mean today.
 */
export default function AgentPageHeader({
  title,
  subtitle,
  action,
  searchAction,
  searchDefaultValue = '',
  searchPlaceholder = 'Rechercher',
  hiddenSearchFields,
  newLeadsCount = 0,
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface px-5 sm:px-8">
      <div className="flex min-h-[4.75rem] flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[1.75rem] font-normal leading-tight tracking-[-0.01em] text-ink sm:text-[1.875rem]">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-[0.8125rem] text-ink-45">{subtitle}</p>}
        </div>

        <div className="flex flex-none flex-wrap items-center gap-2.5">
          {searchAction && (
            <form method="get" action={searchAction} className="relative w-full sm:w-[16rem]">
              {Object.entries(hiddenSearchFields || {}).map(([name, value]) =>
                value ? <input key={name} type="hidden" name={name} value={value} /> : null,
              )}
              <Search
                strokeWidth={ICON_STROKE_WIDTH}
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-35"
                aria-hidden="true"
              />
              <input
                type="search"
                name="q"
                defaultValue={searchDefaultValue}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="u-focus-ring h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-35"
              />
            </form>
          )}

          <Link
            href="/compte/agent/demandes?status=NEW"
            aria-label={`Demandes non traitées${newLeadsCount ? ` (${newLeadsCount})` : ''}`}
            className="u-press relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-70 transition-colors hover:bg-canvas-alt hover:text-ink"
          >
            <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            {!!newLeadsCount && (
              <span className="u-tabular absolute right-1 top-1 min-w-[1rem] rounded-full bg-blue px-1 text-[0.5625rem] font-bold leading-4 text-white">
                {newLeadsCount}
              </span>
            )}
          </Link>

          {action}
        </div>
      </div>
    </header>
  );
}
