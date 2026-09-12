'use client';

import { BedDouble, Bath, Ruler, DoorOpen, FileText, Landmark } from 'lucide-react';
import { hasArea, entryTerms } from '@/lib/listingView';
import { lastCellPresentation, STACKED_CELL_CLASS } from '@/lib/keyFactsGrid';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

// The facts card's own treatments (Claude Design screen): micro-caps label,
// 21px bold value. These used to be the feed card's SPEC_* classes, shared so
// the two rails matched — the detail page now deliberately speaks louder than
// a card in a grid of twenty.
//
// The design's 21px value is a four-across desktop measurement. A phone cell
// is ~151px wide, where 21px breaks "Appartement" mid-word into "Appartem /
// ent" and wraps "SALLES DE BAIN" onto two lines — seen in a 375px browser,
// not assumed. Both step down one notch below `sm` and the layout is
// otherwise identical: same icon, same micro-caps label, same bold value.
const LABEL_CLASS =
  'text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.12em] text-ink-45 sm:text-xs';
// `text-balance` for the reference cell's sake: it is the only value here
// that is free text of unbounded length ("Petit Boulevard, 2ᵉ Rue
// Industrielle" is a real one), and left to itself it wraps into ragged
// lines in a 119px phone cell. Balancing evens them out. It is NOT
// truncated — an agent quotes that reference on WhatsApp and the search bar
// accepts it as a query, so an ellipsis would hide the useful half.
const VALUE_CLASS =
  'text-balance text-[1.0625rem] font-bold leading-tight tracking-normal text-ink sm:text-[1.3125rem]';

/**
 * The design system's KeyFacts (components/property/KeyFacts.jsx) — the
 * four-up fact grid the listing detail page leads with, directly under the
 * price.
 *
 * Design anatomy, followed exactly: a 1px `--border-subtle` grid gap over a
 * chalk (`--surface-sunken`) fill so the cells read as one inset block, an
 * `--royal-600` icon at 20px, a micro-caps label, and a tabular 18px/700
 * value. Icon choices come from the design's own DEFAULT_ICONS map
 * (bed-double / bath / ruler / file-text) with `door-open` added for the
 * "Portes" fact, which is specific to this market's Type Locataire
 * listings and has no counterpart in the design's UK-oriented kit.
 *
 * Replaces the previous `PropertyMetrics` two-column definition list on the
 * detail page. Only facts backed by a real column are emitted — the same
 * null-guards `PropertyMetrics` used, including the `area` TEXT-column '0'
 * trap (see hasArea).
 */
export default function KeyFacts({ listing }) {
  const t = useT();
  const {
    area, beds, bath, units_count: unitsCount, reference,
    category_name: categoryName,
  } = listing;

  // The three entry costs as separate figures, never pre-summed — see
  // entryTerms() for why the sum is the wrong headline.
  const terms = entryTerms(listing);

  // Order matters, and it changed: property type now leads, matching
  // Rightmove's own grid (PROPERTY TYPE / BEDROOMS / BATHROOMS / SIZE) and
  // the feed card's rail, which also opens on "Type de bien".
  //
  // It used to matter more than order should. The list was capped at four
  // cells with `type` sitting LAST, so any listing carrying beds, baths, area
  // and a door count pushed it past the slice and the page never stated what
  // kind of property it was. The cap is gone now that the grid handles a short
  // final row properly (see below) — it was there to keep the block
  // rectangular, and it paid for that by silently dropping real facts: a
  // listing with beds, baths, area, doors AND a deposit showed neither the
  // doors nor the deposit. Every fact a listing actually states now gets a
  // cell. There are at most six, plus the reference.
  const facts = [
    // `categoryName` stays untranslated: it is a real value out of
    // property_category_contents, not UI copy. Only the labels are keys.
    categoryName ? { key: 'type', icon: Landmark, label: t('listings.facts.type'), value: categoryName } : null,
    beds != null ? { key: 'beds', icon: BedDouble, label: t('listings.facts.bedrooms'), value: beds } : null,
    // Number(bath) > 0, not `bath != null` — `bath` carries '' rather than a
    // real NULL when unrecorded, and '' != null is true. Same trap
    // lib/listingView.js's specItems() documents.
    Number(bath) > 0 ? { key: 'bath', icon: Bath, label: t('listings.facts.bathrooms'), value: bath } : null,
    hasArea(area)
      ? { key: 'area', icon: Ruler, label: t('listings.facts.area'), value: t('listings.facts.squareMetres', { value: area }) }
      : null,
    unitsCount != null ? { key: 'units', icon: DoorOpen, label: t('listings.facts.doors'), value: unitsCount } : null,
    // The REFUNDABLE deposit on its own — `terms.parts[0]`, never the total.
    // A "3 + 1 + 1" shown here as "Garantie : 5 mois" is the exact
    // overstatement that splitting the field into three undid: two of those
    // months are rent and commission, and neither comes back.
    //
    // Only for a deposit-only listing. Once advance or commission is stated,
    // EntryCostsBreakdown renders directly below in the same card with the
    // deposit as its first column, so a cell here would say it twice.
    terms && !terms.itemized
      ? {
          key: 'deposit',
          icon: FileText,
          label: t('listings.facts.deposit'),
          // Pluralised: "1 month" vs "3 months" differ in English, where the
          // French "mois" does not change.
          value: t('listings.facts.months', { count: terms.parts[0] }),
        }
      : null,
  ].filter(Boolean);

  // The reference is appended AFTER that cap rather than competing for a slot
  // inside it. It is the one fact on this grid a visitor arrives already
  // holding — an agent quotes it on WhatsApp and the search bar accepts it as
  // a query (lib/searchParser.js) — so it has to be findable on the page the
  // link lands on. Making it compete would also reintroduce the exact bug the
  // cap's note above describes: the slice silently dropping whichever fact
  // came last.
  //
  // Real column only (`properties.reference`), never `quartier` standing in
  // for it and never an id dressed up as one — a listing with no reference
  // renders no cell at all.
  // Reference, then the entry terms — in that order, so on the 2-up mobile
  // grid the reference lands bottom-LEFT and the money bottom-RIGHT.
  const items = [...facts];

  if (reference) {
    items.push({ key: 'reference', icon: FileText, label: t('listings.facts.reference'), value: reference });
  }

  // No "Conditions d'entrée" cell any more: the "3 + 1 + 1" notation is now
  // the headline of EntryCostsBreakdown, directly below in the same card.

  if (items.length === 0) return null;

  // The last row absorbs its own short fall: whichever cell ends the grid
  // stretches over the columns nothing else is using AND lays its content out
  // along the row, so there is neither an empty box beside a real one nor a
  // half-empty stretched cell that reads as one. lib/keyFactsGrid.js owns and
  // documents both halves of that.
  const lastCell = lastCellPresentation(items.length);

  return (
    // 2-up until `md`, not `sm`: at 640-767px four cells are ~160px wide and a
    // value like "Appartement" at 21px wraps inside its own cell. The 1px
    // `gap` over a `bg-line` ground is what draws the dividers — between the
    // two rows and the two columns on a phone, between all four cells on a
    // desktop. lib/keyFactsGrid.js's span classes are tied to this same
    // breakpoint; they move together or the last cell spans a row that isn't
    // there yet.
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line md:grid-cols-4">
      {items.map(({ key, icon: Icon, label, value }, index) => {
        const { className, groupClassName } = index === items.length - 1
          ? lastCell
          : { className: STACKED_CELL_CLASS, groupClassName: '' };

        // `break-words` plus `min-w-0` for the reference cell's sake: a real
        // code like "LKP-2026-0091", or a landmark like "Petit Boulevard, 2ᵉ
        // Rue Industrielle", is longer than any other value this grid holds.
        // `min-w-0` matters only in the row layout, where a flex item's
        // default `min-width: auto` would refuse to shrink and push the cell
        // wider than its column.
        const icon = <Icon strokeWidth={1.75} className="h-4 w-4 shrink-0 text-blue" />;
        const labelEl = <span className={LABEL_CLASS}>{label}</span>;
        const valueEl = (
          <span className={`u-tabular min-w-0 break-words ${VALUE_CLASS}`}>{value}</span>
        );

        // gap-3 over the helper's gap-2 (cn resolves the clash): the design
        // spaces icon, label and value wider than the feed card does.
        return (
          <div key={key} className={cn('bg-canvas-alt p-4 sm:p-5', className, 'gap-3')}>
            {groupClassName ? (
              // Icon and label as ONE flex item where the cell is stretched, so
              // `justify-between` sends the value to the far end of the row.
              // At a width where the cell is NOT stretched this wrapper is
              // `display: contents` and generates no box at all, leaving the
              // cell identical to its neighbours — see lib/keyFactsGrid.js.
              <span className={groupClassName}>
                {icon}
                {labelEl}
              </span>
            ) : (
              <>
                {icon}
                {labelEl}
              </>
            )}
            {valueEl}
          </div>
        );
      })}
    </div>
  );
}
