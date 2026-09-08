'use client';

import { BedDouble, Bath, Ruler, DoorOpen, FileText, Home, Hash } from 'lucide-react';
import { hasArea, entryTerms } from '@/lib/listingView';
import { lastCellPresentation, STACKED_CELL_CLASS } from '@/lib/keyFactsGrid';
import { SPEC_LABEL_CLASS, SPEC_VALUE_CLASS } from './SpecItem';
import { useT } from '@/lib/i18n/client';

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
    categoryName ? { key: 'type', icon: Home, label: t('listings.facts.propertyType'), value: categoryName } : null,
    beds != null ? { key: 'beds', icon: BedDouble, label: t('listings.facts.bedrooms'), value: beds } : null,
    // Number(bath) > 0, not `bath != null` — `bath` carries '' rather than a
    // real NULL when unrecorded, and '' != null is true. Same trap
    // lib/listingView.js's specItems() documents.
    Number(bath) > 0 ? { key: 'bath', icon: Bath, label: t('listings.facts.bathrooms'), value: bath } : null,
    hasArea(area)
      ? { key: 'area', icon: Ruler, label: t('listings.facts.area'), value: t('listings.facts.squareMetres', { value: area }) }
      : null,
    unitsCount != null ? { key: 'units', icon: DoorOpen, label: t('listings.facts.doors'), value: unitsCount } : null,
    // One money cell, not two. When the listing states an advance or a
    // commission alongside the deposit it reads as the local notation the
    // agent wrote — "3 + 1 + 1 mois" under "Conditions d'entrée" — and when
    // it states only a deposit it stays exactly the "Garantie / 3 mois" cell
    // it has always been. A second cell repeating the same money under a
    // different heading would be the more confusing of the two options, and a
    // single "5 mois" total labelled Garantie is the overstatement the split
    // into three fields exists to prevent.
    terms
      ? {
          key: 'terms',
          icon: FileText,
          label: terms.itemized ? t('listings.facts.entryTerms') : t('listings.facts.deposit'),
          value: terms.itemized
            ? t('listings.facts.entryTermsMonths', { parts: terms.parts.join(' + ') })
            // Pluralised: "1 month" vs "3 months" differ in English, where the
            // French "mois" does not change.
            : t('listings.facts.months', { count: terms.parts[0] }),
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
  const items = reference
    ? [...facts, { key: 'reference', icon: Hash, label: t('listings.facts.reference'), value: reference }]
    : facts;

  if (items.length === 0) return null;

  // The last row absorbs its own short fall: whichever cell ends the grid
  // stretches over the columns nothing else is using AND lays its content out
  // along the row, so there is neither an empty box beside a real one nor a
  // half-empty stretched cell that reads as one. lib/keyFactsGrid.js owns and
  // documents both halves of that.
  const lastCell = lastCellPresentation(items.length);

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-4">
      {items.map(({ key, icon: Icon, label, value }, index) => {
        const { className, grouped } = index === items.length - 1
          ? lastCell
          : { className: STACKED_CELL_CLASS, grouped: false };

        // The card rail's own exported treatments (components/SpecItem.js)
        // rather than `u-eyebrow`/`u-body`, so this grid and the feed card
        // state a listing's facts identically. Sharing the constants is also
        // why this grid tracked the card automatically when both were
        // lightened from 800 to 500 — a local copy of those classes would
        // have been left behind at the old weight.
        //
        // `break-words` plus `min-w-0` for the reference cell's sake: a real
        // code like "LKP-2026-0091", or a landmark like "Petit Boulevard, 2ᵉ
        // Rue Industrielle", is longer than any other value this grid holds.
        // `min-w-0` matters only in the row layout, where a flex item's
        // default `min-width: auto` would refuse to shrink and push the cell
        // wider than its column.
        const icon = <Icon strokeWidth={1.75} className="h-5 w-5 shrink-0 text-ink" />;
        const labelEl = <span className={SPEC_LABEL_CLASS}>{label}</span>;
        const valueEl = (
          <span className={`u-tabular min-w-0 break-words text-lg ${SPEC_VALUE_CLASS}`}>{value}</span>
        );

        return (
          <div key={key} className={`bg-canvas-alt p-4 ${className}`}>
            {grouped ? (
              // Icon and label as ONE flex item, so `justify-between` sends the
              // value to the far end of the row instead of spreading all three
              // evenly and stranding the icon away from the words it labels.
              <span className="flex items-center gap-2.5">
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
