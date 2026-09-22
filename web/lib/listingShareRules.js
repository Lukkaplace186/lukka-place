import { SITE_URL } from './constants';

/**
 * Share recording and the print pages — the pure half (no DB, no DOM), so the
 * browser, the server actions and the tests all read one definition.
 * lib/listingShares.js is the SQL.
 *
 * WHAT COUNTS AS A SHARE
 * The agent took the listing out of one of our tools: completed the phone's
 * share sheet with a graphic, downloaded one, opened the caption in WhatsApp,
 * copied it, or pressed "Imprimer" on a poster / technical sheet. It is NOT
 * proof that anybody saw it — every surface that prints a count says so.
 * A share sheet the agent cancels is not recorded. The landlord report itself
 * is not a share of the listing (it goes to the owner, not the market).
 *
 * Channel and format are an allow-list, mirrored by the CHECK constraints in
 * migrations/20260922_listing_shares.sql — change one, change the other.
 */

/** channel → the formats it can carry. */
export const CHANNEL_FORMATS = Object.freeze({
  kit_share: Object.freeze(['square', 'story', 'landscape']),
  kit_download: Object.freeze(['square', 'story', 'landscape']),
  kit_whatsapp: Object.freeze(['text']),
  kit_copy: Object.freeze(['text']),
  menu_whatsapp: Object.freeze(['text']),
  status_share: Object.freeze(['story']),
  status_download: Object.freeze(['story']),
  print: Object.freeze(['poster', 'fiche']),
});

export const SHARE_CHANNELS = Object.freeze(Object.keys(CHANNEL_FORMATS));
export const SHARE_FORMATS = Object.freeze([...new Set(Object.values(CHANNEL_FORMATS).flat())]);

/**
 * One tap = one record. The same listing × channel × format by the same agent
 * inside this window is the same tap arriving twice (a double tap, a retried
 * request), not a second share.
 */
export const SHARE_DEDUPE_SECONDS = 30;
/** A flood cap per agent: nobody shares 60 things a minute by hand. */
export const SHARE_AGENT_PER_MINUTE = 60;
/** Statut du jour sends at most this many ids in one record. */
export const MAX_IDS_PER_RECORD = 5;

/**
 * Validates what the browser sent. Returns null for anything off the
 * allow-list, so the action can refuse without a query.
 *
 * @returns {{ids: number[], channel: string, format: string}|null}
 */
export function normaliseShareRecord(input) {
  const channel = typeof input?.channel === 'string' ? input.channel : '';
  const allowed = CHANNEL_FORMATS[channel];
  if (!allowed) return null;
  const format = typeof input?.format === 'string' ? input.format : '';
  if (!allowed.includes(format)) return null;
  const raw = Array.isArray(input?.listingIds) ? input.listingIds : [input?.listingId];
  const ids = [
    ...new Set(
      raw
        .map((value) => Number(value))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
  if (!ids.length || ids.length > MAX_IDS_PER_RECORD) return null;
  return { ids, channel, format };
}

// ---------------------------------------------------------------------------
// Statut du jour
// ---------------------------------------------------------------------------

/**
 * A listing shared within this many days is "shared recently" and is not
 * suggested again. A WhatsApp Status lasts 24 h; three days leaves room to
 * rotate a small portfolio without showing the same flat every morning.
 */
export const STATUS_RECENT_DAYS = 3;
export const STATUS_MAX = 5;

// ---------------------------------------------------------------------------
// Landlord report
// ---------------------------------------------------------------------------

/**
 * "Partagée 4 fois" for the report card, or null when there is nothing to
 * say: zero, or a count we could not read (table missing, query failed).
 * French always — the report is forwarded to a Kinshasa property owner.
 */
export function shareCountText(count) {
  const n = Number(count);
  if (count == null || !Number.isSafeInteger(n) || n <= 0) return null;
  return `Partagée ${n.toLocaleString('fr-FR').replace(/[  ]/g, ' ')} fois`;
}

export const SHARE_COUNT_DEFINITION =
  'Un partage = un visuel ou un lien de l’annonce généré, envoyé ou imprimé par l’agent depuis les outils Lukka Place. Ce n’est pas une preuve que quelqu’un l’a vu.';

// ---------------------------------------------------------------------------
// Print pages
// ---------------------------------------------------------------------------

export const PRINT_MEDIA = Object.freeze({ poster: 'poster', fiche: 'fiche' });

/**
 * The listing URL a printed QR code carries. utm_source=print is what
 * lib/analyticsClient.js forwards into page_views.source; utm_medium tells a
 * poster from a sheet for anyone reading the raw URL.
 */
export function printListingUrl(id, medium) {
  const safeMedium = PRINT_MEDIA[medium] || PRINT_MEDIA.poster;
  return `${SITE_URL}/listings/${Number(id)}?utm_source=print&utm_medium=${safeMedium}`;
}

/**
 * A Google Maps link to the stored coordinate, or null when there is no real
 * one. latitude/longitude are TEXT columns (lib/listings.js LAT_EXPR), so the
 * value is parsed, and anything out of range is treated as absent rather
 * than printed.
 */
export function mapPinUrl(latitude, longitude) {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function coordinateText(latitude, longitude) {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);
  if (!mapPinUrl(latitude, longitude)) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function parseCoordinate(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
