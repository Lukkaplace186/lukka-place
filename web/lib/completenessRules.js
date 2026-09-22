import { usablePrice } from './format';
import { displayableAgencyName } from './agentIdentity';

/**
 * What is missing from an agent's profile and from each of their listings, as
 * stable gap CODES — the pure half of lib/completeness.js, client-safe so a
 * client component can render the same labels the server computed.
 *
 * A gap is only a gap when the agent can close it from the dashboard. Each
 * code below maps to a real field an agent can fill, and GAP_HREF points at
 * that exact field (a settings anchor or the listing editor). Something the
 * agent cannot act on is left out rather than listed as a permanent nag:
 *
 *   - Coordinates. The web editor has no pin, and nothing on the web write
 *     path geocodes (only the engine's publish-time geocoding and its
 *     backfill script fill latitude/longitude). So `no_map_pin` fires only
 *     when the pin is missing AND the listing has no quartier either — the
 *     quartier is the agent's lever, the one precise input the geocoder
 *     needs. With a quartier set and still no pin, the next backfill run
 *     places it; nagging the agent about it would ask for something they
 *     have already given.
 *   - The deposit applies to a rental only. A sale has no garantie, so
 *     `missing_deposit` never fires on one. Only `deposit_months` is asked
 *     for: it is the one entry-cost field the editor carries, and NULL means
 *     "not stated" (lib/listingView.js's entryTerms), which is the gap.
 *   - Serviced communes count as coverage. services/agentRanking.js scores
 *     `primary_communes` AND `serviced_communes` and excludes an agency that
 *     matches neither, so an agent with either set does get matched; only
 *     both empty means "no matched leads at all".
 *
 * Thresholds are the ones the product already applies, not new ones:
 * MIN_PHOTOS is AgentListingEditor's own "at least 3 photos" hint, and
 * MIN_DESCRIPTION_CHARS is the 15-character floor createListingAction and
 * updateListingAction refuse to save below.
 */

export const MIN_PHOTOS = 3;
export const MIN_DESCRIPTION_CHARS = 15;

/** Listing gap codes, most consequential first. */
export const LISTING_GAP_CODES = [
  'missing_price',
  'no_commune',
  'thin_photos',
  'missing_description',
  'missing_deposit',
  'no_map_pin',
];

/** Profile gap codes, most consequential first. */
export const PROFILE_GAP_CODES = ['no_communes', 'phone_unverified', 'no_logo', 'no_agency_name', 'no_working_hours'];

/*
 * Where each gap is fixed. Settings anchors are the ids on
 * app/compte/agent/parametres/page.js's cards and fields; listing anchors
 * are ids inside components/AgentListingEditor.js (the inputs already carry
 * them; `photos` is the photo card).
 */
const PROFILE_GAP_ANCHORS = {
  no_communes: 'communes',
  phone_unverified: 'identity',
  no_logo: 'identity',
  no_agency_name: 'agency_name',
  no_working_hours: 'hours',
};

const LISTING_GAP_ANCHORS = {
  missing_price: 'price',
  no_commune: 'commune',
  thin_photos: 'photos',
  missing_description: 'description',
  missing_deposit: 'deposit_months',
  no_map_pin: 'quartier',
};

// Réglages opens one section at a time on a phone (`?section=`), so a link
// names the section as well as the field's anchor.
const ANCHOR_SECTION = { agency_name: 'identity' };

export function profileGapHref(code) {
  const anchor = PROFILE_GAP_ANCHORS[code];
  if (!anchor) return '/compte/agent/parametres';
  return `/compte/agent/parametres?section=${ANCHOR_SECTION[anchor] || anchor}#${anchor}`;
}

export function listingGapHref(listingId, code) {
  const anchor = LISTING_GAP_ANCHORS[code];
  const base = `/compte/agent/biens/${encodeURIComponent(listingId)}/edit`;
  return anchor ? `${base}#${anchor}` : base;
}

/** i18n keys — `agent.completeness.gaps.<code>` (chip) and `.hints.<code>` (one line of why). */
export function gapLabelKey(code) {
  return `agent.completeness.gaps.${code}`;
}
export function gapHintKey(code) {
  return `agent.completeness.hints.${code}`;
}

function blank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/** A real coordinate: latitude/longitude are TEXT columns, so '' and garbage both count as none. */
function coordinate(value) {
  if (blank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listLength(value) {
  return Array.isArray(value) ? value.filter((v) => !blank(v)).length : 0;
}

/**
 * @param {{price?: any, purpose?: string, deposit_months?: any, latitude?: any, longitude?: any,
 *   quartier?: string|null, commune?: string|null, description?: string|null, photo_count?: number}} listing
 * @returns {string[]} gap codes in LISTING_GAP_CODES order
 */
export function listingGaps(listing) {
  if (!listing) return [];
  const gaps = new Set();

  if (usablePrice(listing.price) === null) gaps.add('missing_price');
  if (blank(listing.commune)) gaps.add('no_commune');
  if ((Number(listing.photo_count) || 0) < MIN_PHOTOS) gaps.add('thin_photos');
  if (String(listing.description ?? '').trim().length < MIN_DESCRIPTION_CHARS) gaps.add('missing_description');
  if (listing.purpose === 'rent' && blank(listing.deposit_months)) gaps.add('missing_deposit');
  const pinned = coordinate(listing.latitude) !== null && coordinate(listing.longitude) !== null;
  if (!pinned && blank(listing.quartier)) gaps.add('no_map_pin');

  return LISTING_GAP_CODES.filter((code) => gaps.has(code));
}

/**
 * @param {{primary_communes?: string[], serviced_communes?: string[], image?: string|null,
 *   working_hours?: string|null, agency_name?: string|null, vendor_name?: string|null,
 *   phone_verified_at?: any}} agent
 * @returns {string[]} gap codes in PROFILE_GAP_CODES order
 */
export function profileGaps(agent) {
  if (!agent) return [];
  const gaps = new Set();

  if (listLength(agent.primary_communes) === 0 && listLength(agent.serviced_communes) === 0) gaps.add('no_communes');
  if (!agent.phone_verified_at) gaps.add('phone_unverified');
  if (blank(agent.image)) gaps.add('no_logo');
  // The agency the agent is attached to already names them when it has a
  // real name. A phone-shaped string is not one (displayableAgencyName), nor
  // is vendorNameSql's own "Agence #12" placeholder for a nameless vendor.
  const vendorName = /^Agence #\d+$/.test(String(agent.vendor_name ?? '').trim()) ? null : agent.vendor_name;
  if (!displayableAgencyName(agent.agency_name) && !displayableAgencyName(vendorName)) gaps.add('no_agency_name');
  if (blank(agent.working_hours)) gaps.add('no_working_hours');

  return PROFILE_GAP_CODES.filter((code) => gaps.has(code));
}
