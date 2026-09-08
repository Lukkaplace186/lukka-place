'use client';

import { BedDouble, Bath, Ruler, DoorOpen, FileText, Home, Hash } from 'lucide-react';
import { hasArea } from '@/lib/listingView';
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
    category_name: categoryName, deposit_months: depositMonths,
  } = listing;

  // Order matters, and it changed: property type now leads, matching
  // Rightmove's own grid (PROPERTY TYPE / BEDROOMS / BATHROOMS / SIZE) and
  // the feed card's rail, which also opens on "Type de bien".
  //
  // This was a real bug, not just a preference. The list is capped at four
  // cells, and `type` used to sit LAST — so any listing carrying beds, baths,
  // area and a door count pushed it past the slice and the page never stated
  // what kind of property it was. That mattered more once the h1 stopped
  // being the "… Appartement à louer à …" sentence: the type would have had
  // nowhere left to appear.
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
    depositMonths != null
      ? {
          key: 'deposit',
          icon: FileText,
          label: t('listings.facts.deposit'),
          // Pluralised: "1 month" vs "3 months" differ in English, where the
          // French "mois" does not change.
          value: t('listings.facts.months', { count: depositMonths }),
        }
      : null,
  ].filter(Boolean).slice(0, 4);

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

  // This grid draws its 1px rules by letting a `bg-line` container show
  // through a `gap-px`, which means any cell the last row is SHORT of shows
  // through as a slab of rule colour rather than as nothing. Four facts
  // divided exactly, so it never came up; a fifth cell makes it a rectangle
  // with a grey corner missing. These fillers are empty continuations of the
  // block's own surface — no borrowed data, nothing announced to a screen
  // reader — and the count differs per breakpoint because the grid is 2-up on
  // mobile and 4-up from `sm`. Rendering the 4-up count unconditionally would
  // add a whole blank row on a phone.
  const mobileFillers = (2 - (items.length % 2)) % 2;
  const desktopFillers = (4 - (items.length % 4)) % 4;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-4">
      {items.map(({ key, icon: Icon, label, value }) => (
        <div key={key} className="flex flex-col gap-2 bg-canvas-alt p-4">
          <Icon strokeWidth={1.75} className="h-5 w-5 text-ink" />
          {/* The card rail's own exported treatments (components/SpecItem.js)
              rather than `u-eyebrow`/`u-body`, so this grid and the feed card
              state a listing's facts identically. Sharing the constants is
              also why this grid tracked the card automatically when both
              were lightened from 800 to 500 — a local copy of those classes
              would have been left behind at the old weight. */}
          <span className={SPEC_LABEL_CLASS}>{label}</span>
          {/* `break-words` for the reference cell's sake: a real code like
              "LKP-2026-0091" is longer than any other value this grid holds
              and would otherwise run out of a quarter-width cell. */}
          <span className={`u-tabular break-words text-lg ${SPEC_VALUE_CLASS}`}>{value}</span>
        </div>
      ))}
      {Array.from({ length: desktopFillers }, (unused, index) => (
        <div
          key={`filler-${index}`}
          aria-hidden="true"
          className={`bg-canvas-alt ${index < mobileFillers ? '' : 'hidden sm:block'}`}
        />
      ))}
    </div>
  );
}
