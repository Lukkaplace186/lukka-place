import Link from 'next/link';
import { Bell } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentHeaderSearch from './AgentHeaderSearch';

/**
 * The design's 76px sticky dashboard header: page title in DM Serif at
 * 30px, then a search field, a notification bell and the primary action,
 * right-aligned.
 *
 * Both of the design's "chrome" controls are wired to something real
 * rather than being decorative:
 *  - The search box (AgentHeaderSearch) filters the current section as the
 *    agent types (`?q=`), and is still a plain GET form underneath. It only
 *    appears where there is something to search; pages that pass no
 *    `searchAction` render no box at all rather than an input that does
 *    nothing.
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
    // ONE row on a phone too: title, then the search icon, bell and action
    // (AgentHeaderSearch opens over this row when tapped). The earlier
    // two-row version — title, then search + bell — cost ~110px of a phone
    // screen and left a lone bell under short titles.
    <header className="sticky top-0 z-20 border-b border-line bg-surface px-3 sm:px-8">
      <div className="relative flex min-h-[3.5rem] items-center justify-between gap-2 py-2 sm:min-h-[4.75rem] sm:flex-wrap sm:gap-x-4 sm:gap-y-3 sm:py-3">
        <div className="min-w-0 flex-1">
          <h1 className="u-title-page truncate text-ink">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 hidden text-[0.8125rem] text-ink-45 sm:block">{subtitle}</p>}
        </div>

        <div className="flex flex-none items-center gap-1 sm:flex-wrap sm:gap-2.5">
          {searchAction && (
            <AgentHeaderSearch
              action={searchAction}
              defaultValue={searchDefaultValue}
              placeholder={searchPlaceholder}
              hiddenFields={hiddenSearchFields}
            />
          )}

          <Link
            href="/compte/agent/demandes?status=NEW"
            aria-label={`Demandes non traitées${newLeadsCount ? ` (${newLeadsCount})` : ''}`}
            className="u-press relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-70 transition-colors hover:bg-canvas-alt hover:text-ink"
          >
            <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            {!!newLeadsCount && (
              <span className="u-tabular absolute right-1 top-1 min-w-[1rem] rounded-full bg-blue px-1 text-[0.6875rem] font-bold leading-4 text-white">
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
