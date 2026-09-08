/**
 * The one layout decision in components/KeyFacts.js that can be got wrong
 * silently, pulled out so it can be pinned by a test rather than by a
 * screenshot.
 *
 * That grid draws its 1px rules by letting a `bg-line` container show through
 * a `gap-px`, so a final row the items do not fill leaves rule colour showing
 * where the missing cells would be. Closing the gap with empty filler cells
 * was the first attempt and was wrong in a way a screenshot showed
 * immediately: an empty cell is not nothing, it is a blank white box sitting
 * beside a real one. Stretching the LAST REAL cell over the leftover columns
 * leaves neither a blank box nor a strip of rule colour, and needs no extra
 * markup.
 *
 * Two breakpoints, two remainders: the grid is 2-up on mobile and 4-up from
 * `sm`, so a count can be short in one and exact in the other (six cells fill
 * every mobile row but leave two columns spare on desktop).
 *
 * Every class here is a complete literal string. Tailwind v4 scans source
 * text, so an interpolated `sm:col-span-${n}` compiles to nothing at all — see
 * web/CLAUDE.md on uncommon span utilities silently not being generated.
 */
const DESKTOP_SPAN_FOR_REMAINDER = {
  0: '',
  1: 'sm:col-span-4',
  2: 'sm:col-span-3',
  3: 'sm:col-span-2',
};

/**
 * @param {number} count How many cells the grid renders.
 * @returns {string} Tailwind classes for the LAST cell — '' when both rows
 *   divide exactly and the cell should stay one column wide.
 */
export function lastCellSpanClass(count) {
  if (!Number.isInteger(count) || count < 1) return '';

  return [
    count % 2 === 1 ? 'col-span-2' : '',
    DESKTOP_SPAN_FOR_REMAINDER[count % 4],
  ]
    .filter(Boolean)
    .join(' ');
}
