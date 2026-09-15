/**
 * services/leadCommunes.js
 *
 * A customer request can name several communes ("Gombe, Ngaliema ou
 * Lingwala"). `leads.commune` is a single TEXT column and every existing
 * reader keeps using it, so the full list lives beside it in `leads.communes`
 * (a JSON array) and `commune` is always that list's first entry.
 *
 * Before this, web/'s "Trouver pour moi" form collected several communes and
 * posted only the first: the agencies covering every other commune the
 * customer picked were never told the request existed, which is the one thing
 * the matching push is for.
 */

const { resolveCommune } = require('./locations');

/**
 * A request naming more communes than this is no longer a targeted search,
 * and each commune costs one ranking query at dispatch. web/'s form enforces
 * the same number; the engine enforces it too because POST /leads is an API.
 */
const MAX_LEAD_COMMUNES = 5;

/**
 * Canonical, de-duplicated commune list from whatever the caller sent.
 *
 * Each name is resolved against kinshasa_locations.json (root CLAUDE.md:
 * never invent a location). A name that does not resolve is kept as typed
 * rather than dropped — it came from the customer, and matching compares
 * case-insensitively, so an unresolvable name costs nothing but a ranking
 * query that finds nobody. Dropping it would silently lose part of the
 * request, which is the bug this module exists to fix.
 *
 * @param {unknown} list    `communes` from the request body (array expected).
 * @param {unknown} primary `commune` from the request body, placed first.
 * @returns {string[]}
 */
function normaliseLeadCommunes(list, primary) {
  const raw = [primary, ...(Array.isArray(list) ? list : [])];
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const name = resolveCommune(trimmed) || trimmed;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_LEAD_COMMUNES) break;
  }
  return out;
}

/**
 * Every commune a lead row names, primary first. Rows written before
 * `communes` existed (and every lead the WhatsApp assistant creates) carry
 * only `commune`, which is read as a one-entry list.
 *
 * @param {{commune?: string|null, communes?: string|null}} lead
 * @returns {string[]}
 */
function leadCommunes(lead) {
  if (!lead) return [];
  let parsed = [];
  if (typeof lead.communes === 'string' && lead.communes) {
    try {
      const value = JSON.parse(lead.communes);
      if (Array.isArray(value)) parsed = value.filter((c) => typeof c === 'string' && c.trim());
    } catch {
      parsed = [];
    }
  }
  if (parsed.length > 0) return parsed;
  return lead.commune ? [lead.commune] : [];
}

/**
 * True when `next` no longer names a commune `previous` named. Adding a
 * commune keeps every existing proposal relevant (it was pitched for a
 * commune the customer still wants); removing one may not, and a proposal
 * does not record which commune it was pitched for, so any removal resets.
 */
function communesRemoved(previous, next) {
  const kept = new Set(next.map((c) => c.toLowerCase()));
  return previous.some((c) => !kept.has(c.toLowerCase()));
}

/** Communes present in `next` that `previous` did not name. */
function communesAdded(previous, next) {
  const had = new Set(previous.map((c) => c.toLowerCase()));
  return next.filter((c) => !had.has(c.toLowerCase()));
}

module.exports = {
  MAX_LEAD_COMMUNES,
  normaliseLeadCommunes,
  leadCommunes,
  communesRemoved,
  communesAdded,
};
