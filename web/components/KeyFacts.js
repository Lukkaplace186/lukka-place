'use client';

import { BedDouble, Bath, Ruler, DoorOpen, FileText, Home } from 'lucide-react';
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
    area, beds, bath, units_count: unitsCount,
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
  const items = [
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

  if (items.length === 0) return null;

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
          <span className={`u-tabular text-lg ${SPEC_VALUE_CLASS}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}
