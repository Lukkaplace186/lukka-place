/**
 * lib/marketProspectRules.js — pure rules for "Coller des annonces" and the
 * prospects list (engine migrations/20261105_market_prospects.sql,
 * services/marketPaste.js).
 *
 * One paste of adverts (Facebook, Zwandako, a website, a WhatsApp group)
 * feeds two things the team used to type twice: each advert's asking price
 * goes to `market_observations` (the price guide's medians) and the person
 * who posted it goes to `market_prospects` (agents to recruit). The engine
 * reads the paste; a team member checks every row; one save writes both.
 *
 * No `server-only`: the paste table (client) shapes its rows with these and
 * the Server Action re-checks with the same functions.
 */

import { PROPERTY_KINDS } from './marketObservationRules';

/** The tracker's follow-up vocabulary, kept as it was (the table's CHECK). */
export const PROSPECT_STATUSES = ['todo', 'noanswer', 'callback', 'interested', 'signed', 'declined', 'optout'];
export const PROSPECT_CHANNELS = ['whatsapp', 'phone', 'in_person', 'facebook', 'other'];

/** Statuses still worth a call (the default filter). */
export const OPEN_PROSPECT_STATUSES = ['todo', 'noanswer', 'callback', 'interested'];

export const MAX_PASTE_CHARS = 12000;
export const MAX_PASTE_ROWS = 30;

/** Digits only, 7–15 (E.164 range). A local "0812…" was already made 243… by the engine. */
export function prospectPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^0[89]\d{8}$/.test(digits)) return `243${digits.slice(1)}`;
  if (/^[89]\d{8}$/.test(digits)) return `243${digits}`;
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

/** "+243 812 345 678" for a DRC number, "+<digits>" otherwise. */
export function formatProspectPhone(digits) {
  const d = String(digits || '');
  if (/^243\d{9}$/.test(d)) return `+243 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return d ? `+${d}` : '';
}

const text = (value, max) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : '';
};

/**
 * Engine advert → one editable row of the paste table (strings, as form
 * fields hold them). Never fills a fact the engine did not keep: an
 * unverified price, an unresolved commune and an unverified number stay
 * empty for the team member to type from the post.
 */
export function advertToRow(advert, index, { communes = [] } = {}) {
  const a = advert || {};
  const kind = PROPERTY_KINDS.includes(a.property_kind) ? a.property_kind : '';
  const commune = communes.includes(a.commune) ? a.commune : '';
  const phone = prospectPhone(a.contact_phone);
  return {
    key: `r${index}`,
    keepPrice: true,
    keepProspect: Boolean(phone),
    purpose: a.purpose === 'sale' ? 'sale' : 'rent',
    property_kind: kind,
    beds: Number.isInteger(a.beds) ? String(a.beds) : '',
    price: Number.isFinite(a.price) && a.price > 0 ? String(a.price) : '',
    priceUnverified: Boolean(a.price_unverified),
    currency: a.currency === 'CDF' ? 'CDF' : 'USD',
    price_period: a.purpose === 'sale' ? 'total' : (['mois', 'an', 'jour', 'semaine'].includes(a.price_period) ? a.price_period : 'mois'),
    furnished: a.furnished === true ? 'yes' : a.furnished === false ? 'no' : '',
    commune,
    communeWritten: !commune && a.commune_written ? text(a.commune_written, 60) : '',
    communeFromQuartier: Boolean(commune && a.commune_from_quartier),
    quartier: text(a.quartier, 120),
    title: text(a.title, 200),
    name: text(a.contact_name, 120),
    agency: text(a.agency_name, 120),
    phone: phone || '',
    postedHint: text(a.posted_hint, 60),
  };
}

/**
 * The prospect half of one row, or `{ok: false, error}` (an i18n key under
 * admin.marketPaste.errors). A row with no number is not a prospect — a name
 * alone cannot be called back — and that is not an error, just nothing.
 */
export function validateProspect(row) {
  if (!row?.keepProspect) return { ok: true, value: null };
  const phone = prospectPhone(row.phone);
  if (!phone) return { ok: false, error: 'phone' };
  return {
    ok: true,
    value: { phone, name: text(row.name, 120) || null, agency: text(row.agency, 120) || null },
  };
}

/**
 * The fields of one advert's price row, as validateManualObservation reads
 * them (the batch's source and page link apply to every row).
 */
export function observationInput(row, { source, sourceUrl = '' }) {
  return {
    source,
    source_url: sourceUrl,
    posted_at: '',
    purpose: row.purpose,
    property_kind: row.property_kind,
    beds: row.beds,
    price: row.price,
    currency: row.currency,
    price_period: row.price_period,
    furnished: row.furnished,
    commune: row.commune,
    quartier: row.quartier,
    title: row.title,
  };
}

/**
 * The text an advert's source_ref is hashed from: the advert's own facts and
 * its poster, so pasting the same post again (or its repost) is one row, and
 * two adverts copied from one page are two.
 */
export function pasteRefSeed(value, phone) {
  return [
    value.source, phone || '', value.purpose, value.property_kind, value.beds ?? '', value.price,
    value.price_period, (value.commune || '').toLowerCase(), (value.quartier || '').toLowerCase(),
  ].join('|');
}

/** Merge a pasted source into a prospect's list (kept unique, insertion order). */
export function mergeSources(existing, source) {
  const list = Array.isArray(existing) ? existing.filter(Boolean) : [];
  return source && !list.includes(source) ? [...list, source] : list;
}
