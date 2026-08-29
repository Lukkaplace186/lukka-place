// Matches lukka-place-engine/services/postgres.js's NO_PHOTO_URL exactly —
// the site's own "no photo" placeholder, already publicly reachable (see
// next.config.mjs's remotePatterns).
export const NO_PHOTO_URL = 'https://lukkaplace.com/assets/img/noimage.jpg';

// Matches services/openai.js's PARCELLE_SUBTYPES in the engine repo exactly —
// shared between SearchBar (homepage) and FilterBar (/listings).
export const PARCELLE_SUBTYPES = [
  { value: 'maison_type_locataire', label: 'Maison Type Locataire' },
  { value: 'villa', label: 'Villa' },
  { value: 'terrain_nu', label: 'Terrain Nu' },
];

// lucide-react convention — import icons individually (`import { Search } from
// 'lucide-react'`) and pass these so every icon across buttons, filter pills,
// and property cards shares one stroke weight/size instead of drifting per
// component. ICON_ACCENT_CLASS is the blue accent tint — the same
// --color-blue token already used for buttons/active tabs/links
// (see app/globals.css) — for an icon signaling an active/selected/CTA state;
// a neutral icon (e.g. inert metadata) should use `text-ink-45`
// instead, not this class.
export const ICON_SIZE = 18;
export const ICON_STROKE_WIDTH = 1.75;
export const ICON_ACCENT_CLASS = 'text-blue-deep';

// Real deployed origin, used to build a shareable listing link inside the
// WhatsApp pre-filled message (lib/whatsapp.js). Falls back to the real
// production domain rather than an obviously-fake placeholder if the env
// var is ever unset somewhere.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com';

/**
 * Plural labels for the results heading only.
 *
 * The list of property types a visitor can actually pick is derived from the
 * database at request time (getPropertyTypeFacets in lib/listings.js), so an
 * option that would return zero results is never offered. This map exists
 * purely so the heading reads "Appartements disponibles" rather than
 * "Appartement disponibles"; anything not listed falls back to the raw label.
 * 'Duplex' is invariable in French and is listed to document that.
 */
export const PROPERTY_TYPE_PLURALS = {
  parcelle: 'Parcelles',
  appartement: 'Appartements',
  maison: 'Maisons',
  duplex: 'Duplex',
  terrain: 'Terrains',
  batiment: 'Bâtiments',
  boutique: 'Boutiques',
  entrepot: 'Entrepôts',
};

export const TRANSACTION_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'vente', label: 'À vendre' },
  { value: 'location', label: 'À louer' },
];

/**
 * "Plus de filtres" amenity checkboxes — DRC/Kinshasa-specific priorities
 * (generator, solar, borehole, security, etc.). No structured column exists
 * for any of these on `properties` (see web/CLAUDE.md's "No fabricated
 * data" section): services/openai.js's intake parser extracts a free-text
 * `amenities` array and a `furnished` boolean, but services/postgres.js's
 * sync path never writes either to a real column on the public table.
 * lib/listings.js's buildFilters therefore matches these against the real
 * title/description text (word-boundary regex, not a verified structured
 * flag) — the same honesty posture the existing free-text search fallback
 * already uses for "avec piscine"/"meublé" style queries. A checkbox here
 * can have real false negatives (a listing that has a feature but never
 * mentioned it) — it is a real, working filter, just not a database-verified
 * one, and the drawer says so.
 *
 * `key` here must match a key in AMENITY_KEYWORDS below exactly —
 * lib/listings.js's buildFilters (server-side WHERE clause) and
 * lib/listingView.js's matchedAmenityKeys (client-side card badges) both
 * import that same map, so the keyword list per amenity lives in exactly
 * one place and can't drift silently: buildFilters ignores any key it
 * doesn't recognise, and this file's keys are the only ones the UI can
 * ever send.
 */
export const AMENITY_GROUPS = [
  {
    title: 'Énergie & Eau',
    options: [
      { key: 'generator', label: 'Groupe électrogène' },
      { key: 'solar', label: 'Panneaux solaires / Inverseur' },
      { key: 'borehole', label: "Forage / Citerne d'eau" },
      { key: 'dedicated_line', label: 'Ligne SNEL dédiée' },
    ],
  },
  {
    title: 'Accessibilité & Sécurité',
    options: [
      { key: 'paved_road', label: 'Route asphaltée / pavée' },
      { key: 'security', label: 'Clôture / Gardiennage' },
      { key: 'parking', label: 'Parking intérieur' },
    ],
  },
  {
    title: 'Conditions de location',
    options: [
      { key: 'ac', label: 'Climatisation' },
      { key: 'furnished', label: 'Meublé' },
      { key: 'semi_furnished', label: 'Semi-meublé' },
    ],
  },
];

/**
 * The actual keyword list per AMENITY_GROUPS key — matched with a
 * leading-word-boundary regex (`\b`/`~*'\y...'`, no trailing boundary) by
 * both consumers, not plain substring matching: confirmed live that a plain
 * substring check on "meuble" (furnished) matches inside "immeuble"
 * (building), a real false positive, while French adjectives inflect for
 * gender/number ("climatisées"), so the trailing boundary is deliberately
 * omitted — see lib/listings.js's buildFilters doc comment for the full
 * verification notes.
 */
export const AMENITY_KEYWORDS = {
  generator: ['groupe électrogène', 'groupe electrogene', 'générateur', 'generateur'],
  solar: ['panneau solaire', 'panneaux solaires', 'inverseur', 'onduleur'],
  borehole: ['forage', 'citerne'],
  dedicated_line: ['ligne dédiée', 'ligne dediee', 'ligne snel dédiée', 'ligne snel dediee', 'snel dédié', 'snel dedie'],
  paved_road: ['route asphaltée', 'route asphaltee', 'route pavée', 'route pavee', 'asphalté', 'asphalte', 'bitumé', 'bitume'],
  security: ['clôture', 'cloture', 'gardiennage', 'gardien'],
  parking: ['parking', 'garage'],
  ac: ['climatisation', 'climatisé', 'climatise', 'climatiseur'],
  furnished: ['meublé', 'meuble', 'meublée', 'meublee'],
  // Substring of `furnished`'s own keywords ("meublé" sits inside
  // "semi-meublé"), so a semi-furnished listing legitimately matches both —
  // real overlap, not a bug: the text genuinely contains both claims.
  semi_furnished: ['semi-meublé', 'semi meublé', 'semi-meuble', 'semi meuble', 'semi-meublée', 'semi meublee'],
};

/**
 * "Max Garantie / Avance" — deposit_months IS a real, structured column
 * (added 2026-08-19, see web/CLAUDE.md's Known Gaps section), so unlike
 * AMENITY_GROUPS above this filters on real, verified data. A listing whose
 * deposit_months is still unknown (NULL — most rows synced before that
 * migration, or never republished since) is excluded rather than silently
 * counted as a match: lib/listings.js requires `deposit_months IS NOT NULL`
 * whenever this filter is active.
 */
export const DEPOSIT_MAX_OPTIONS = [
  { value: '', label: 'Toutes' },
  { value: '1', label: '1 mois' },
  { value: '3', label: '3 mois' },
  { value: '6', label: '6 mois' },
  { value: '10', label: '10+ mois' },
];
