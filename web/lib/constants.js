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
