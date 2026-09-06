/**
 * Property-type identity for map markers: one colour + one glyph per real
 * category in this database.
 *
 * The pin colour is a data encoding, not decoration, so the kinds are keyed
 * off the fields that actually carry the type — `parcelle_subtype` first,
 * then `category_name` — exactly the precedence lib/listingView.js's
 * typeLabel() already uses, so a pin can never disagree with the label the
 * card shows for the same listing.
 *
 * The category list is the real one (property_category_contents, language 26,
 * verified against the live database): Appartement, Maison, Penthouse,
 * Bâtiment, Boutique, Duplex, Terrain, Entrepôt. There is no "agence"
 * category — agencies are not plotted on this map at all, so no kind is
 * defined for one; the fourth colour goes to the commercial categories
 * (Bâtiment / Boutique / Entrepôt), which are real and reachable.
 *
 * Glyph paths are lucide's own (building-2, house, sprout, store — v1.32.0,
 * ISC, already a dependency of this app), inlined rather than imported: a
 * google.maps.Marker icon is a flat SVG string handed to the Maps JS API and
 * never mounted in React's tree, so a <Building2 /> component can't render
 * into one. They are drawn in lucide's own 24x24 stroke space and scaled by
 * the icon builder.
 *
 * Colours are hardcoded hexes for the same reason lib/mapStyle.js's are:
 * nothing in an SVG handed to the Maps API resolves a CSS custom property.
 */

/** lucide `building-2` */
const GLYPH_BUILDING = [
  'M10 12h4',
  'M10 8h4',
  'M14 21v-3a2 2 0 0 0-4 0v3',
  'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2',
  'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16',
];

/** lucide `house` */
const GLYPH_HOUSE = [
  'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
  'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
];

/** lucide `sprout` */
const GLYPH_SPROUT = [
  'M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3',
  'M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4',
  'M5 21h14',
];

/** lucide `store` */
const GLYPH_STORE = [
  'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5',
  'M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244',
  'M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05',
];

/** lucide `map-pin` — the neutral fallback glyph only (see UNKNOWN_KIND). */
const GLYPH_PIN = [
  'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
  'M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
];

export const MARKER_KINDS = {
  appartement: {
    key: 'appartement',
    label: 'Appartement',
    color: '#1D4ED8',
    colorDark: '#12328F',
    glyph: GLYPH_BUILDING,
  },
  maison: {
    key: 'maison',
    label: 'Maison / Villa',
    color: '#166534',
    colorDark: '#0D4423',
    glyph: GLYPH_HOUSE,
  },
  terrain: {
    key: 'terrain',
    label: 'Terrain',
    color: '#F97316',
    colorDark: '#C2530A',
    glyph: GLYPH_SPROUT,
  },
  commerce: {
    key: 'commerce',
    label: 'Commercial',
    color: '#DC2626',
    colorDark: '#A11616',
    glyph: GLYPH_STORE,
  },
};

/**
 * Only reached by a listing whose category is neither a parcelle sub-type nor
 * one of the eight real categories — i.e. a category added to the Laravel
 * admin after this map was written. A neutral ink pin is the honest render
 * for that: it still shows the listing at its real position without claiming
 * a type we don't recognise.
 */
export const UNKNOWN_KIND = {
  key: 'autre',
  label: 'Autre',
  color: '#3C4457',
  colorDark: '#232A38',
  glyph: GLYPH_PIN,
};

/** The kinds the legend offers, in reading order. */
export const LEGEND_KINDS = [
  MARKER_KINDS.appartement,
  MARKER_KINDS.maison,
  MARKER_KINDS.terrain,
  MARKER_KINDS.commerce,
];

// Keys are accent-stripped and lowercased before lookup, so 'Bâtiment' and
// 'Entrepôt' (which is how they really are spelled in
// property_category_contents) match without duplicated accented entries.
const KIND_BY_TYPE = {
  // parcelle_subtype (lib/constants.js's PARCELLE_SUBTYPES)
  maison_type_locataire: MARKER_KINDS.maison,
  villa: MARKER_KINDS.maison,
  terrain_nu: MARKER_KINDS.terrain,
  // category_name
  appartement: MARKER_KINDS.appartement,
  duplex: MARKER_KINDS.appartement,
  penthouse: MARKER_KINDS.appartement,
  maison: MARKER_KINDS.maison,
  terrain: MARKER_KINDS.terrain,
  batiment: MARKER_KINDS.commerce,
  boutique: MARKER_KINDS.commerce,
  entrepot: MARKER_KINDS.commerce,
};

function normalizeType(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** The marker kind for one listing. Never returns null — see UNKNOWN_KIND. */
export function resolveMarkerKind(listing) {
  const subtype = normalizeType(listing?.parcelle_subtype);
  if (subtype && KIND_BY_TYPE[subtype]) return KIND_BY_TYPE[subtype];

  const category = normalizeType(listing?.category_name);
  if (category && KIND_BY_TYPE[category]) return KIND_BY_TYPE[category];

  return UNKNOWN_KIND;
}
