import { formatPrice } from './format';
import { listingPublicUrl, shareBlocker } from './listingShareCopy';
import { normalizeStoredPhone } from './phone';
import { buildWhatsAppLink } from './whatsapp';

/**
 * The agent client book's matcher: which of an agent's OWN live listings fit
 * which of the clients they saved from their own WhatsApp chats
 * (/compte/agent/clients). Pure and client-safe — no DB, no 'server-only' —
 * so the rules are tested here once and the pages only feed it rows.
 *
 * Computed at READ time, never stored. Listings are written by both the
 * engine (WhatsApp intake) and web (the dashboard), so a stored match table
 * would need a trigger on both paths and would still go stale the moment a
 * price changed. Matching a few hundred clients against a few hundred
 * listings is microseconds.
 *
 * The rules, all four required:
 *   - purpose matches exactly (a tenant is never offered a sale),
 *   - the listing's commune is one of the client's communes — when the client
 *     named any; an empty list means "anywhere",
 *   - the price is inside the budget with BUDGET_TOLERANCE either side
 *     (±10 %: "up to 500 $" still matches a 540 $ flat, which is how agents
 *     actually read a budget), USD against properties.price,
 *   - bedrooms >= what the client asked for.
 * A fact the listing does not state (no price, no bedroom count, no commune
 * tag) is NOT a match when the client constrained it: we would be telling the
 * agent a listing fits on a criterion nobody can check.
 *
 * Only listings a customer can actually open are matched (shareBlocker): the
 * message carries a link to the public page, which 404s for anything pending,
 * archived or closed.
 */

export const BUDGET_TOLERANCE = 0.1;
export const CLIENT_TRANSACTION_TYPES = Object.freeze(['location', 'vente']);
export const MAX_CLIENT_COMMUNES = 10;
export const CLIENT_NAME_MAX = 120;
export const CLIENT_NOTES_MAX = 2000;
export const CLIENT_BUDGET_MAX = 100_000_000;
export const CLIENT_BEDROOMS_MAX = 50;

const PURPOSE_BY_TRANSACTION = Object.freeze({ location: 'rent', vente: 'sale' });

/** utm tags on every link sent from the client book. Only utm_source is recorded today. */
export const CLIENT_LINK_TRACKING = Object.freeze({ source: 'whatsapp', medium: 'agent', campaign: 'client_book' });

/**
 * A comparison key for a commune name: accents, case and separators ignored.
 * The client's communes come from the engine's GET /locations and a listing's
 * from amenity_contents; both are canonical, but "Ngiri-Ngiri" vs
 * "Ngiri Ngiri" must not be the difference between a match and none.
 */
export function communeKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolves typed/selected commune names against the real list. Returns the
 * CANONICAL spelling for each hit and every name that matched nothing — the
 * caller refuses the form rather than storing a free-text commune.
 *
 * @param {string[]} input
 * @param {string[]} validCommunes canonical names (GET /locations)
 * @returns {{communes: string[], unknown: string[]}}
 */
export function resolveCommunes(input, validCommunes) {
  const byKey = new Map((validCommunes || []).map((name) => [communeKey(name), name]));
  const communes = [];
  const unknown = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const canonical = byKey.get(communeKey(text));
    if (!canonical) unknown.push(text);
    else if (!communes.includes(canonical)) communes.push(canonical);
  }
  return { communes, unknown };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Is `price` inside [min, max] with `tolerance` either side? A budget with no
 * bound accepts anything; a constrained budget refuses a listing with no
 * usable price.
 */
export function withinBudget(price, min, max, tolerance = BUDGET_TOLERANCE) {
  const low = toNumberOrNull(min);
  const high = toNumberOrNull(max);
  if (low === null && high === null) return true;
  const value = toNumberOrNull(price);
  if (value === null || value <= 0) return false;
  if (low !== null && value < low * (1 - tolerance)) return false;
  if (high !== null && value > high * (1 + tolerance)) return false;
  return true;
}

/**
 * Why a client and a listing do or do not match — the first failed rule, or
 * null. Exposed for the tests and for any caller that wants to say why.
 *
 * @returns {null|'unavailable'|'purpose'|'commune'|'budget'|'bedrooms'}
 */
export function clientMismatchReason(client, listing) {
  if (!client || !listing) return 'unavailable';
  if (shareBlocker(listing) !== null) return 'unavailable';

  const purpose = PURPOSE_BY_TRANSACTION[client.transaction_type];
  if (!purpose || listing.purpose !== purpose) return 'purpose';

  const wanted = Array.isArray(client.communes) ? client.communes.filter(Boolean) : [];
  if (wanted.length > 0) {
    const key = communeKey(listing.commune);
    if (!key || !wanted.some((c) => communeKey(c) === key)) return 'commune';
  }

  if (!withinBudget(listing.price, client.budget_min, client.budget_max)) return 'budget';

  const bedrooms = toNumberOrNull(client.bedrooms);
  if (bedrooms !== null && bedrooms > 0) {
    const beds = toNumberOrNull(listing.beds);
    if (beds === null || beds < bedrooms) return 'bedrooms';
  }

  return null;
}

export function clientMatchesListing(client, listing) {
  return clientMismatchReason(client, listing) === null;
}

/**
 * Every client x listing pair that matches, indexed both ways. Plain objects
 * keyed by String(id) — properties.id is a bigint and arrives as a string
 * from node-postgres — so the result can be handed to a client component.
 *
 * @returns {{byListing: Record<string, string[]>, byClient: Record<string, string[]>}}
 */
export function matchClientsToListings(clients, listings) {
  const byListing = {};
  const byClient = {};
  for (const listing of listings || []) {
    for (const client of clients || []) {
      if (!clientMatchesListing(client, listing)) continue;
      const lid = String(listing.id);
      const cid = String(client.id);
      (byListing[lid] ||= []).push(cid);
      (byClient[cid] ||= []).push(lid);
    }
  }
  return { byListing, byClient };
}

/**
 * The first word of a real name, or null. A client saved with a phone-shaped
 * "name" gets no greeting rather than "Bonjour 243812…".
 */
export function clientFirstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÀ-ÿ]/.test(first) ? first : null;
}

export function clientListingUrl(listingId) {
  return listingPublicUrl(listingId, CLIENT_LINK_TRACKING);
}

/**
 * What the agent's own WhatsApp opens pre-filled with. ALWAYS FRENCH, like
 * lib/listingShareCopy.js: it is read by the agent's customer in Kinshasa, not
 * by the agent. Every part is a real field; a missing one is left out.
 */
export function buildClientListingMessage(client, listing) {
  const first = clientFirstName(client?.name);
  const lines = [first ? `Bonjour ${first},` : 'Bonjour,', "j'ai un bien qui correspond à votre recherche :"];
  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  const facts = [listing.title, place, formatPrice(listing.price, listing.purpose, listing.price_period)].filter(Boolean);
  lines.push('', facts.join(' — '), '', clientListingUrl(listing.id));
  return lines.join('\n');
}

/** A wa.me link to the client with the message typed in, or null for an unusable number. */
export function clientWhatsAppLink(client, listing) {
  const phone = normalizeStoredPhone(client?.phone);
  return phone ? buildWhatsAppLink(phone, buildClientListingMessage(client, listing)) : null;
}

function contactKey(clientId, listingId) {
  return `${clientId}:${listingId}`;
}

/**
 * One row per matching client for a listing, ready for a client component:
 * name, the pre-filled wa.me link, and when the agent last opened it.
 *
 * @param {{clients: Object[], contacts: Record<string, string>, byListing: Record<string, string[]>}} book
 */
export function matchEntriesForListing(book, listing) {
  const ids = book?.byListing?.[String(listing?.id)] || [];
  const clientsById = new Map((book?.clients || []).map((c) => [String(c.id), c]));
  return ids
    .map((cid) => clientsById.get(cid))
    .filter(Boolean)
    .map((client) => ({
      clientId: String(client.id),
      listingId: String(listing.id),
      name: client.name,
      href: clientWhatsAppLink(client, listing),
      contactedAt: book?.contacts?.[contactKey(client.id, listing.id)] || null,
    }));
}

/** The mirror image: one row per matching listing for a client. */
export function matchEntriesForClient(book, client) {
  const ids = book?.byClient?.[String(client?.id)] || [];
  const listingsById = new Map((book?.listings || []).map((l) => [String(l.id), l]));
  return ids
    .map((lid) => listingsById.get(lid))
    .filter(Boolean)
    .map((listing) => ({
      clientId: String(client.id),
      listingId: String(listing.id),
      title: listing.title,
      place: [listing.quartier, listing.commune].filter(Boolean).join(', '),
      price: formatPrice(listing.price, listing.purpose, listing.price_period),
      href: clientWhatsAppLink(client, listing),
      contactedAt: book?.contacts?.[contactKey(client.id, listing.id)] || null,
    }));
}

/** `{ [listingId]: entries }` for every listing with at least one match. */
export function matchEntriesByListing(book) {
  const out = {};
  for (const listing of book?.listings || []) {
    const entries = matchEntriesForListing(book, listing);
    if (entries.length) out[String(listing.id)] = entries;
  }
  return out;
}

function parseAmount(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  const text = String(value).replace(/[\s  $]/g, '').replace(',', '.');
  if (!text) return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > CLIENT_BUDGET_MAX) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * Validates a client-book form. `phone` must already be digits-only E.164 —
 * the Server Action gets it from phoneFromForm (country-aware), never from a
 * guess here. Returns an i18n key on failure, not a sentence, so this module
 * stays free of the dictionary (same shape as validatePhotoSelection).
 *
 * @param {{name, phone, transaction_type, communes, budget_min, budget_max, bedrooms, notes}} fields
 * @param {{validCommunes: string[]}} options
 * @returns {{ok: true, value: Object}|{ok: false, errorKey: string}}
 */
export function parseClientFields(fields, { validCommunes = [] } = {}) {
  const name = String(fields?.name || '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, errorKey: 'agent.clients.errors.name' };
  if (name.length > CLIENT_NAME_MAX) return { ok: false, errorKey: 'agent.clients.errors.name' };

  const phone = normalizeStoredPhone(fields?.phone);
  if (!phone) return { ok: false, errorKey: 'agent.clients.errors.phone' };

  const transactionType = String(fields?.transaction_type || '');
  if (!CLIENT_TRANSACTION_TYPES.includes(transactionType)) return { ok: false, errorKey: 'agent.clients.errors.purpose' };

  const { communes, unknown } = resolveCommunes(fields?.communes, validCommunes);
  if (unknown.length > 0) return { ok: false, errorKey: 'agent.clients.errors.commune' };
  if (communes.length > MAX_CLIENT_COMMUNES) return { ok: false, errorKey: 'agent.clients.errors.tooManyCommunes' };

  const min = parseAmount(fields?.budget_min);
  const max = parseAmount(fields?.budget_max);
  if (!min.ok || !max.ok) return { ok: false, errorKey: 'agent.clients.errors.budget' };
  if (min.value !== null && max.value !== null && min.value > max.value) {
    return { ok: false, errorKey: 'agent.clients.errors.budget' };
  }

  let bedrooms = null;
  const bedsText = String(fields?.bedrooms ?? '').trim();
  if (bedsText) {
    const n = Number(bedsText);
    if (!Number.isInteger(n) || n < 0 || n > CLIENT_BEDROOMS_MAX) return { ok: false, errorKey: 'agent.clients.errors.bedrooms' };
    bedrooms = n;
  }

  const notesText = String(fields?.notes || '').trim();
  if (notesText.length > CLIENT_NOTES_MAX) return { ok: false, errorKey: 'agent.clients.errors.notes' };

  return {
    ok: true,
    value: {
      name,
      phone,
      transaction_type: transactionType,
      communes,
      budget_min: min.value,
      budget_max: max.value,
      bedrooms,
      notes: notesText || null,
    },
  };
}
