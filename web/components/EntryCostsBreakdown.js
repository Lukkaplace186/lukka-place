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
  'rounded-full border border-ink-25 px-1.5 py-0.5 text-[10px] leading-tight text-ink-70 sm:px-2.5 sm:py-1 sm:text-xs';

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
          <p className="u-tabular mt-3 text-[1.75rem] font-extrabold leading-none tracking-tight text-ink sm:text-[2.25rem] md:text-[2.75rem]">
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
          <p className="u-tabular mt-3.5 text-2xl font-extrabold leading-none tracking-tight text-blue-deep sm:text-[1.75rem] md:text-[2.25rem]">
            {lines.map((line, index) => (
              <span key={line.key}>
                {index > 0 ? <span className="px-[0.18em]">+</span> : null}
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
                ? `h-4 rounded-full ${SEGMENT_CLASS[line.key]}`
                : 'h-4 rounded-full border border-dashed border-ink-25'
            }
          />
        ))}
      </div>

      {/* One row per poste at every width, including a 375px phone — the
          three postes are one comparison, and stacking them turned it into
          three separate facts you scroll past.

          `grid-rows-subgrid` keeps the three columns honest: a title that
          wraps to two lines ("Commission · 1 mois" in a ~95px phone column)
          would otherwise push that column's amount and pills out of line
          with its neighbours. Each li spans the same three rows — title,
          amount, tags — so the figures stay level across all three.

          The column count is inline rather than a `grid-cols-N` class: a
          "4 + 1" listing renders two columns, and Tailwind v4 scans source
          text, so an interpolated class name would compile to nothing. */}
      <ul
        className="mt-6 grid grid-rows-[auto_auto_auto] gap-x-2 divide-x divide-line sm:mt-7 sm:gap-x-4"
        style={{ gridTemplateColumns: `repeat(${lines.length}, minmax(0,1fr))` }}
      >
        {lines.map((line) => (
          <li key={line.key} className="row-span-3 grid min-w-0 grid-rows-subgrid pl-2 first:pl-0 sm:pl-4 sm:first:pl-0">
            <div className="flex items-start gap-1.5 text-pretty text-xs font-semibold leading-tight text-ink sm:text-sm">
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
              <p className="u-tabular mt-1.5 text-sm font-bold leading-tight text-ink sm:mt-2.5 sm:text-lg">
                {money(line.amount)}
              </p>
            ) : null}
            {/* `items-start`: this row is shared with the other columns via
                subgrid, so it is as tall as the tallest set of tags (the
                deposit's two). Without it a lone pill stretches to that
                height and `rounded-full` draws it as an oval. */}
            <div className="mt-1.5 flex flex-wrap items-start gap-1 sm:mt-3 sm:gap-2">
              <span className={TAG_CLASS}>{t(`listings.entryCosts.recipient.${line.recipient}`)}</span>
              {line.refundable ? <span className={TAG_CLASS}>{t('listings.entryCosts.refundable')}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
