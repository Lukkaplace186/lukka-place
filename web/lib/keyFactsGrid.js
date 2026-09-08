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
 * @param {number} count How many cells the grid renders.
 * @returns {{className: string, grouped: boolean}} Layout for the LAST cell.
 *   `className` carries both the column span and the flex direction.
 *   `grouped` says whether the caller should wrap the icon and label together
 *   as one flex item, which is what puts the value at the far end of the row.
 *   It stays true for the stacked-then-row case: the direction changes at `sm`
 *   but the DOM cannot, so the grouping has to be there before the flip.
 */
export function lastCellPresentation(count) {
  if (!Number.isInteger(count) || count < 1) return { className: STACKED, grouped: false };

  const stretchedOnMobile = count % 2 === 1;
  const desktopSpan = DESKTOP_SPAN_FOR_REMAINDER[count % 4];

  // Divides exactly into both rows — an ordinary cell, nothing to correct.
  if (!stretchedOnMobile && !desktopSpan) return { className: STACKED, grouped: false };

  const span = [stretchedOnMobile ? 'col-span-2' : '', desktopSpan].filter(Boolean).join(' ');
  const layout = stretchedOnMobile ? ROW : STACKED_THEN_ROW;

  return { className: `${span} ${layout}`, grouped: true };
}

/** The stacked layout every other cell uses. Exported so KeyFacts has one source for it. */
export const STACKED_CELL_CLASS = STACKED;
