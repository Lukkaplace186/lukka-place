import { matchPercent } from './agentMatching';
import { formatPrice } from './format';
import { listingPublicUrl, shareBlocker } from './listingShareCopy';
import { communeKey, clientFirstName } from './clientMatching';

/**
 * "Proposer des alternatives" — an agent sends a customer up to three similar
 * listings in ONE WhatsApp message, from a lead card or a visit card
 * (typically after "déjà loué" / a declined visit). Pure and client-safe: the
 * dialog previews exactly the text the Server Action will send, because both
 * call buildAlternativesMessage.
 *
 * Ranking reuses rules rather than forking them:
 *   - purpose is a hard filter, as in the engine's viewingSweeps fix (a rental
 *     shopper offered a sale was the bug documented there);
 *   - a listing in one of the requested communes ranks first — the same
 *     preference propertyMatching expresses by searching the commune before
 *     widening city-wide;
 *   - then lib/agentMatching.js's matchPercent (budget + bedrooms), the score
 *     the lead card already shows;
 *   - then freshness.
 * The declined/enquired listing itself is never proposed, and nothing that is
 * not publicly live (shareBlocker) is offered, since the link would 404.
 */

export const MAX_ALTERNATIVES = 3;
export const ALTERNATIVES_TRACKING = Object.freeze({ source: 'whatsapp', medium: 'agent', campaign: 'alternatives' });

const PURPOSE_BY_TRANSACTION = Object.freeze({ location: 'rent', vente: 'sale' });

export function alternativeUrl(listingId) {
  return listingPublicUrl(listingId, ALTERNATIVES_TRACKING);
}

/** leads.communes is a JSON array stored as TEXT (engine services/leadCommunes.js); `commune` is the legacy single value. */
export function parseLeadCommunes(lead) {
  let list = [];
  const raw = lead?.communes;
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  list = list.map((c) => String(c || '').trim()).filter(Boolean);
  const single = String(lead?.commune || lead?.lead_commune || '').trim();
  if (list.length === 0 && single) list = [single];
  return [...new Set(list)];
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * What to look for. The customer's own request wins where it says something;
 * otherwise the listing they asked about stands in for it (a visit request
 * carries no budget or commune of its own — root CLAUDE.md, lead_matches
 * note). The listing's price becomes a ceiling for ranking only; it is never
 * shown to anyone as the customer's budget.
 *
 * @param {{lead?: Object|null, listing?: Object|null}} source
 * @returns {{purpose: string|null, communes: string[], price_min: number|null, price_max: number|null, bedrooms: number|null}}
 */
export function alternativesCriteria({ lead = null, listing = null } = {}) {
  const purpose = PURPOSE_BY_TRANSACTION[lead?.transaction_type] || listing?.purpose || null;

  let communes = parseLeadCommunes(lead);
  if (communes.length === 0 && listing?.commune) communes = [listing.commune];

  let priceMin = num(lead?.price_min);
  let priceMax = num(lead?.price_max);
  if (priceMin === null && priceMax === null) priceMax = num(listing?.price);

  const bedrooms = num(lead?.bedrooms) ?? num(listing?.beds);

  return { purpose, communes, price_min: priceMin, price_max: priceMax, bedrooms: bedrooms && bedrooms > 0 ? bedrooms : null };
}

/**
 * @param {Object[]} candidates listing rows (id, purpose, price, beds, commune, status, approve_status, listing_status, created_at)
 * @param {ReturnType<typeof alternativesCriteria>} criteria
 * @param {{excludeIds?: Array<string|number>}} [options]
 * @returns {Array<{listing: Object, communeMatch: boolean|null, score: number|null}>}
 */
export function rankAlternatives(candidates, criteria, { excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds.filter((id) => id != null).map(String));
  const wanted = new Set((criteria?.communes || []).map(communeKey).filter(Boolean));
  const seen = new Set();
  const ranked = [];

  for (const listing of candidates || []) {
    const id = String(listing?.id ?? '');
    if (!id || seen.has(id) || excluded.has(id)) continue;
    seen.add(id);
    if (shareBlocker(listing) !== null) continue;
    if (criteria?.purpose && listing.purpose !== criteria.purpose) continue;

    const communeMatch = wanted.size ? wanted.has(communeKey(listing.commune)) : null;
    ranked.push({ listing, communeMatch, score: matchPercent(listing, criteria || {}) });
  }

  const time = (l) => {
    const t = new Date(l.created_at || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return ranked.sort(
    (a, b) =>
      Number(b.communeMatch === true) - Number(a.communeMatch === true) ||
      (b.score ?? 50) - (a.score ?? 50) ||
      time(b.listing) - time(a.listing),
  );
}

/**
 * The one message. ALWAYS FRENCH (read by the customer — see
 * lib/listingShareCopy.js). Neutral on purpose: it does not say why the
 * first listing is off the table, because a decline has several reasons and
 * only the agent knows which.
 *
 * @param {Object[]} listings 1..MAX_ALTERNATIVES rows (id, title, price, purpose, price_period, quartier, commune)
 * @param {{name?: string|null}} [options]
 */
export function buildAlternativesMessage(listings, { name = null } = {}) {
  const list = (listings || []).slice(0, MAX_ALTERNATIVES);
  const first = clientFirstName(name);
  const lines = [first ? `Bonjour ${first},` : 'Bonjour,', ''];
  lines.push(
    list.length === 1
      ? 'Voici un autre bien qui pourrait vous intéresser :'
      : `Voici ${list.length} autres biens qui pourraient vous intéresser :`,
  );
  list.forEach((listing, index) => {
    const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
    const facts = [listing.title, place, formatPrice(listing.price, listing.purpose, listing.price_period)].filter(Boolean);
    lines.push('', `${index + 1}. ${facts.join(' — ')}`, alternativeUrl(listing.id));
  });
  lines.push('', 'Dites-moi celui que vous souhaitez visiter.');
  return lines.join('\n');
}

/** The trimmed row a client component needs — no description, no agent fields. */
export function alternativeSummary(entry, { own = false } = {}) {
  const { listing } = entry;
  return {
    id: String(listing.id),
    title: listing.title || '',
    price: listing.price == null ? null : Number(listing.price),
    purpose: listing.purpose || null,
    price_period: listing.price_period || null,
    beds: listing.beds == null ? null : Number(listing.beds),
    quartier: listing.quartier || null,
    commune: listing.commune || null,
    featured_image: listing.featured_image || null,
    communeMatch: entry.communeMatch,
    own,
  };
}
