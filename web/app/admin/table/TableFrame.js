/**
 * The dense table shell every paginated /admin list uses. Server-safe.
 *
 * The frame scrolls on both axes inside its own box so the header row can be
 * `sticky` against it — a sticky <th> inside a horizontally-scrolling wrapper
 * sticks to that wrapper, not to the page, so the frame has to own the
 * vertical scroll too. A page is at most 100 rows (lib/adminPagination.js), so
 * the DOM stays small and no virtualisation layer is needed on top.
 */

export const TH_STICKY =
  'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-3 py-2 text-left text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ink-35';
export const TH_STICKY_RIGHT = `${TH_STICKY} text-right`;
export const TD_DENSE = 'u-micro px-3 py-2 align-top text-ink-70';
export const TD_DENSE_RIGHT = `${TD_DENSE} u-tabular text-right`;
export const TR_DENSE = 'border-b border-line last:border-0 hover:bg-canvas-alt/60';

export function TableFrame({ children, minWidth = '56rem', footer = null, busy = false }) {
  return (
    <div className="u-card overflow-hidden rounded-card bg-surface" aria-busy={busy || undefined}>
      <div className="max-h-[calc(100vh-16rem)] min-h-[12rem] overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth }}>
          {children}
        </table>
      </div>
      {footer}
    </div>
  );
}

/** One full-width row for "nothing matches these filters" — keeps the header and pager in place. */
export function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-12 text-center">
        <p className="u-micro text-ink-45">{children}</p>
      </td>
    </tr>
  );
}
