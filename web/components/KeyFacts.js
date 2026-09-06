import { BedDouble, Bath, Ruler, DoorOpen, FileText, Home } from 'lucide-react';
import { hasArea } from '@/lib/listingView';
import { SPEC_LABEL_CLASS, SPEC_VALUE_CLASS } from './SpecItem';

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
    categoryName ? { key: 'type', icon: Home, label: 'Type de bien', value: categoryName } : null,
    beds != null ? { key: 'beds', icon: BedDouble, label: 'Chambres', value: beds } : null,
    // Number(bath) > 0, not `bath != null` — `bath` carries '' rather than a
    // real NULL when unrecorded, and '' != null is true. Same trap
    // lib/listingView.js's specItems() documents.
    Number(bath) > 0 ? { key: 'bath', icon: Bath, label: 'Salles de bain', value: bath } : null,
    hasArea(area) ? { key: 'area', icon: Ruler, label: 'Superficie', value: `${area} m²` } : null,
    unitsCount != null ? { key: 'units', icon: DoorOpen, label: 'Portes', value: unitsCount } : null,
    depositMonths != null
      ? { key: 'deposit', icon: FileText, label: 'Garantie', value: `${depositMonths} mois` }
      : null,
  ].filter(Boolean).slice(0, 4);

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-4">
      {items.map(({ key, icon: Icon, label, value }) => (
        <div key={key} className="flex flex-col gap-2 bg-canvas-alt p-4">
          <Icon strokeWidth={2} className="h-5 w-5 text-ink-70" />
          {/* Was `u-eyebrow text-ink-35` (12px/500) over `u-body` (16px/400)
              — the lightest pairing on the page, and `u-eyebrow` is shared by
              30 other files so it could not be thickened in place without
              re-weighting the whole app. These are the card rail's own
              exported treatments instead (components/SpecItem.js), which
              also pins ink-45 for the label: ink-35 measures 3.62:1 on this
              chalk cell and fails AA at label size. */}
          <span className={SPEC_LABEL_CLASS}>{label}</span>
          <span className={`u-tabular text-lg ${SPEC_VALUE_CLASS}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}
