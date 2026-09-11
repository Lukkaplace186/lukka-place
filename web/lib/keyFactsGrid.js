/**
 * The two layout decisions in components/KeyFacts.js that can be got wrong
 * silently, pulled out so they can be pinned by a test rather than by a
 * screenshot.
 *
 * That grid draws its 1px rules by letting a `bg-line` container show through
 * a `gap-px`, so a final row the items do not fill leaves rule colour showing
 * where the missing cells would be. This has now been wrong twice, in two
 * different ways, and both fixes are here:
 *
 *   1. Filler cells. Closing the short row with empty cells was the first
 *      attempt and a screenshot killed it immediately: an empty cell is not
 *      nothing, it is a blank white box sitting beside a real one. The LAST
 *      REAL cell stretches over the leftover columns instead.
 *   2. Dead space inside the stretched cell. Stretching alone leaves a cell
 *      twice the width of its neighbours with its content still stacked in the
 *      top-left corner — so the right half is empty, and since the rows above
 *      carry a rule at the midpoint the eye continues that line down and reads
 *      the emptiness as a second box anyway. Reported from the live site as
 *      exactly that. A stretched cell therefore lays its content out along the
 *      row: icon and label together on the left, value on the right.
 *
 * Two breakpoints, two remainders: the grid is 2-up on mobile and 4-up from
 * `sm`, so a count can be short in one and exact in the other. Six cells fill
 * every mobile row but leave two desktop columns spare — that cell must stay
 * stacked on a phone (it is half-width there and a single line would cramp)
 * and go horizontal only from `sm`. An odd count is short in both, since an
 * odd number is never divisible by four.
 *
 * Every class here is a complete literal. Tailwind v4 scans source text, so an
 * interpolated `sm:col-span-${n}` compiles to nothing and the hole comes back
 * silently — see web/CLAUDE.md on uncommon span utilities.
 */

/** How many columns the last cell must absorb, by its 4-up remainder. */
const DESKTOP_SPAN_FOR_REMAINDER = {
  0: '',
  1: 'sm:col-span-4',
  2: 'sm:col-span-3',
  3: 'sm:col-span-2',
};

/** A cell that is one column wide everywhere: the grid's normal stacked cell. */
const STACKED = 'flex flex-col gap-2';

/** Stretched at every width — content runs along the row at every width too. */
const ROW = 'flex items-center justify-between gap-4';

/** Exact on mobile, stretched from `sm`: stacked on a phone, row on a desktop. */
const STACKED_THEN_ROW = 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4';

/**
 * The icon and label travel as ONE flex item in a row layout, so
 * `justify-between` sends the value to the far end instead of spreading all
 * three evenly and stranding the icon away from the words it labels.
 */
const GROUP = 'flex items-center gap-2.5';

/**
 * ...but that grouping must be invisible at a width where the cell is NOT
 * stretched, or the one cell whose layout flips at `sm` would sit its icon
 * beside its label on a phone while every other cell stacks its icon above.
 * Seen on the live six-cell grid, and it reads as a mistake because it is one.
 *
 * `display: contents` is the fix: the wrapper stops generating a box, the icon
 * and label become direct children of the cell's own flex column, and the cell
 * is pixel-identical to its neighbours. At `sm` the wrapper becomes a real
 * flex item again and the grouping comes back.
 */
const GROUP_FROM_SM = 'contents sm:flex sm:items-center sm:gap-2.5';

/**
 * @param {number} count How many cells the grid renders.
 * @returns {{className: string, groupClassName: string}} Layout for the LAST
 *   cell. `className` carries both the column span and the flex direction.
 *   `groupClassName` is empty when the cell is ordinary; otherwise it is the
 *   class for a wrapper the caller puts around the icon and label — real at
 *   the widths where the cell is stretched, `display: contents` (invisible to
 *   layout) at the widths where it is not. The DOM cannot change per
 *   breakpoint, so the wrapper is always present and the CSS decides whether
 *   it counts.
 */
export function lastCellPresentation(count) {
  if (!Number.isInteger(count) || count < 1) return { className: STACKED, groupClassName: '' };

  const stretchedOnMobile = count % 2 === 1;
  const desktopSpan = DESKTOP_SPAN_FOR_REMAINDER[count % 4];

  // Divides exactly into both rows — an ordinary cell, nothing to correct.
  if (!stretchedOnMobile && !desktopSpan) return { className: STACKED, groupClassName: '' };

  const span = [stretchedOnMobile ? 'col-span-2' : '', desktopSpan].filter(Boolean).join(' ');

  return stretchedOnMobile
    ? { className: `${span} ${ROW}`, groupClassName: GROUP }
    : { className: `${span} ${STACKED_THEN_ROW}`, groupClassName: GROUP_FROM_SM };
}

/** The stacked layout every other cell uses. Exported so KeyFacts has one source for it. */
export const STACKED_CELL_CLASS = STACKED;
