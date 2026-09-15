import { entryCostBreakdown } from '@/lib/listingView';
import { formatPriceParts } from '@/lib/format';
import { getT } from '@/lib/i18n/server';

/**
 * What a tenant hands over at signing, and to whom — the lower half of the
 * listing page's facts card (the KeyFacts grid is the upper half; page.js
 * owns the card around both).
 *
 * Anatomy, from the Claude Design screen: the total due at signing as the
 * headline figure, the agent's own notation ("3 + 1 + 1") opposite it, one
 * segmented bar sized by months, and one column per poste — equal thirds at
 * every width, including a phone — carrying the figure and who banks it.
 *
 * Every figure comes from entryCostBreakdown(), which only ever reports what
 * the listing states. There are no defaults: a listing that says "Garantie :
 * 4 mois" and nothing else renders nothing here (KeyFacts keeps its deposit
 * cell instead), and a "4 + 1" renders two postes, not three. Filling in the
 * "+ 1 + 1" that usually follows would put money on the page — and in a
 * customer's budget — that nobody asked for. Most live listings are exactly
 * that deposit-only shape.
 */

// Colour is keyed to the POSTE, not to its position in the list, so a "4 + 1"
// still shows the deposit in the deep shade and the advance in the mid one.
// The light shade has no token: --blue-tint (#eef2ff) is too pale to read as
// a bar segment on white, and this is the design's own value.
const SEGMENT_CLASS = {
  deposit: 'bg-blue-deep',
  advance: 'bg-[var(--blue-400)]',
  commission: 'bg-[#dde3fb]',
};

const TAG_CLASS =
  'rounded-full border border-ink-25 px-1.5 py-0.5 text-[11px] leading-tight text-ink-70 sm:px-2.5 sm:py-1 sm:text-xs';

/**
 * Three postes stop fitting side by side below a 300px row. Measured in a
 * browser, not estimated: "Commission" beside its swatch (~87px) and the
 * "Remboursable" tag (~84px) cannot wrap, and three equal columns give them
 * ~77px on a 320px phone and ~82px on a 360px one — the most common Android
 * width — so both spilled into the next column. A 375px phone has 302px and
 * keeps the row.
 *
 * Below that, each poste becomes one line of its own: title and amount side
 * by side, tags underneath. A container query, not a breakpoint, because what
 * runs out is this row's width, not the viewport's. Two postes fit at every
 * width, so a "4 + 1" never stacks.
 *
 * `@max-*` rather than `@min-*` for the wide layout: the base classes stay
 * the row, and nothing here has to out-rank a `sm:` class, since a viewport
 * past `sm` never leaves this row under 300px.
 */
const STACK_BELOW_300 = {
  list: '@max-[18.75rem]:grid-cols-1 @max-[18.75rem]:grid-rows-none @max-[18.75rem]:divide-x-0 @max-[18.75rem]:divide-y',
  item: '@max-[18.75rem]:row-span-1 @max-[18.75rem]:grid-rows-[auto_auto] @max-[18.75rem]:grid-cols-[minmax(0,1fr)_auto] @max-[18.75rem]:gap-x-3 @max-[18.75rem]:py-3 @max-[18.75rem]:pl-0 @max-[18.75rem]:first:pt-0 @max-[18.75rem]:last:pb-0',
  amount: '@max-[18.75rem]:mt-0 @max-[18.75rem]:text-right',
  tags: '@max-[18.75rem]:col-span-2',
};
const NO_STACK = { list: '', item: '', amount: '', tags: '' };

/**
 * The bar's segments, sized by months — a true 3:1:1 for a "3 + 1 + 1".
 *
 * The columns below are equal thirds and no longer sit under their own
 * segment, so nothing constrains these weights any more: the coloured dot
 * beside each poste's title is what ties a column to its segment now.
 */
function barTemplate(lines) {
  // A stated zero ("pas de commission") still gets a sliver so its segment
  // exists; it is drawn as an empty outline, since there is no money in it.
  return lines.map((line) => `minmax(0,${line.months > 0 ? line.months : 0.4}fr)`).join(' ');
}

export default async function EntryCostsBreakdown({ listing }) {
  const breakdown = entryCostBreakdown(listing);
  if (!breakdown) return null;

  const t = await getT();
  const { lines, totalMonths, totalAmount, hasAmounts } = breakdown;
  // One-off sums, so formatted as non-recurring — formatPriceParts appends
  // "/ mois" to anything a rental passes it, and "3 750 $ / mois" reads as a
  // monthly charge five times the rent. `.amount` is the bare figure.
  const money = (value) => formatPriceParts(value, 'oneOff').amount;
  const months = (count) => t('listings.facts.months', { count });
  const segments = barTemplate(lines);
  const stack = lines.length > 2 ? STACK_BELOW_300 : NO_STACK;

  return (
    <section
      className="mt-6 border-t border-line pt-7 first:mt-0 first:border-t-0 first:pt-0"
      style={{ '--entry-cols': segments }}
    >
      {/* Side by side at every width, including a 390px phone: the total and
          the formula are the two halves of one statement, and wrapping the
          formula under the total reads as a separate fact. Both scale down
          instead of wrapping — at 390px they occupy ~236px of ~350px. */}
      <div className="flex items-start justify-between gap-4 sm:gap-6">
        <div className="min-w-0">
          <h2 className="text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.12em] text-ink-45 sm:text-xs">
            {t('listings.entryCosts.heading')}
          </h2>
          {/* Semibold, not extrabold: the figure leads by SIZE, so it can share
              the KeyFacts grid's weight class above it instead of shouting
              over it. Soft contrast, still the loudest thing in the card. */}
          <p className="u-tabular mt-3 text-[1.75rem] font-semibold leading-none tracking-[-0.02em] text-ink sm:text-[2.125rem] md:text-[2.5rem]">
            {hasAmounts ? money(totalAmount) : months(totalMonths)}
          </p>
          <p className="mt-2.5 text-sm text-ink-45 sm:text-[0.9375rem]">
            {hasAmounts
              ? t('listings.entryCosts.atSigningMonths', { count: totalMonths })
              : t('listings.entryCosts.atSigning')}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <span className="block text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.12em] text-blue sm:text-xs">
            {t('listings.entryCosts.formula')}
          </span>
          {/* The agent's own notation, in the order the columns below use. */}
          {/* Royal blue rather than blue-deep, and the operators dropped to a
              light tint so the digits carry the notation. */}
          <p className="u-tabular mt-3.5 text-2xl font-semibold leading-none tracking-[-0.01em] text-blue sm:text-[1.75rem] md:text-[2.125rem]">
            {lines.map((line, index) => (
              <span key={line.key}>
                {index > 0 ? <span className="px-[0.22em] font-normal text-[var(--blue-400)] opacity-50">+</span> : null}
                {line.months}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Decorative: every figure it encodes is stated as text below. */}
      <div
        aria-hidden="true"
        className="mt-7 grid gap-x-1 [grid-template-columns:var(--entry-cols)]"
      >
        {lines.map((line) => (
          <span
            key={line.key}
            className={
              line.months > 0
                ? `h-2.5 rounded-full ${SEGMENT_CLASS[line.key]}`
                : 'h-2.5 rounded-full border border-dashed border-ink-25'
            }
          />
        ))}
      </div>

      {/* One row per poste, including on a 375px phone — the three postes
          are one comparison, and stacking them turned it into three separate
          facts you scroll past. The one exception is a three-poste row with
          under 300px to work with; see STACK_BELOW_300.

          `grid-rows-subgrid` keeps the three columns honest: a title that
          wraps to two lines ("Commission · 1 mois" in a ~95px phone column)
          would otherwise push that column's amount and pills out of line
          with its neighbours. Each li spans the same three rows — title,
          amount, tags — so the figures stay level across all three.

          The column count is a custom property rather than a `grid-cols-N`
          class: a "4 + 1" listing renders two columns, and Tailwind v4 scans
          source text, so an interpolated class name would compile to
          nothing. Not an inline `gridTemplateColumns` either, which would
          outrank the stacked layout's `grid-cols-1`. */}
      <div className="@container mt-6 sm:mt-7">
      <ul
        className={`grid grid-rows-[auto_auto_auto] gap-x-2 divide-x divide-line [grid-template-columns:var(--entry-poste-cols)] sm:gap-x-4 ${stack.list}`}
        style={{ '--entry-poste-cols': `repeat(${lines.length}, minmax(0,1fr))` }}
      >
        {lines.map((line) => (
          <li key={line.key} className={`row-span-3 grid min-w-0 grid-rows-subgrid pl-2 first:pl-0 sm:pl-4 sm:first:pl-0 ${stack.item}`}>
            <div className="flex items-start gap-1.5 text-pretty text-xs font-medium leading-tight text-ink-70 sm:text-sm">
              {/* The swatch is the only thing tying a column to its segment
                  now that the columns are equal thirds, so it shows at every
                  width. `mt-0.5` sits it on the title's first line. */}
              <span aria-hidden="true" className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${SEGMENT_CLASS[line.key]}`} />
              <span>
                {t(`listings.entryCosts.${line.key}`)} · {months(line.months)}
              </span>
            </div>
            {/* No amount without a real monthly rent to multiply — a sale
                price times five months is a number nobody owes. */}
            {hasAmounts ? (
              <p className={`u-tabular mt-1.5 text-sm font-semibold leading-tight text-ink sm:mt-2.5 sm:text-lg ${stack.amount}`}>
                {money(line.amount)}
              </p>
            ) : null}
            {/* `items-start`: this row is shared with the other columns via
                subgrid, so it is as tall as the tallest set of tags (the
                deposit's two). Without it a lone pill stretches to that
                height and `rounded-full` draws it as an oval. */}
            <div className={`mt-1.5 flex flex-wrap items-start gap-1 sm:mt-3 sm:gap-2 ${stack.tags}`}>
              <span className={TAG_CLASS}>{t(`listings.entryCosts.recipient.${line.recipient}`)}</span>
              {line.refundable ? <span className={TAG_CLASS}>{t('listings.entryCosts.refundable')}</span> : null}
            </div>
          </li>
        ))}
      </ul>
      </div>
    </section>
  );
}
