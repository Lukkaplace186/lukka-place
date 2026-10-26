/**
 * Public agent directory (/agents) — the pure half: what the URL asks for,
 * how a link changes it, and how an agent is named on a card. The SQL is in
 * lib/agentDirectory.js. Tests: tests/unit/agent-directory.test.js.
 *
 * Every filter lives in the URL (GET form, no client state), so a search is
 * one server render, works with JavaScript off on a slow phone, and can be
 * shared on WhatsApp as a link.
 */
import { CITIES, findCity, cityOfCommune } from './cities';
import { displayableAgencyName } from './agentIdentity';

/** One page of cards. Small enough for a 3G phone, large enough to scroll. */
export const DIRECTORY_PAGE_SIZE = 24;

export const DIRECTORY_SORTS = ['listings', 'rating', 'recent'];
export const DIRECTORY_OFFERS = ['location', 'vente'];

/** Search box cap: a name, not an essay. */
const MAX_QUERY_LENGTH = 60;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {Record<string, string|string[]|undefined>} searchParams
 * @returns {{q: string, ville: string|null, commune: string|null, offre: string|null, verifies: boolean, tri: string, page: number}}
 */
export function parseDirectoryParams(searchParams = {}) {
  const q = String(first(searchParams.q) || '').trim().slice(0, MAX_QUERY_LENGTH);

  const city = findCity(first(searchParams.ville));
  let ville = city ? city.name : null;

  // A commune is accepted only as a real key from the city data; it also
  // decides the city, so ?commune=Kampemba alone means Lubumbashi.
  const communeRaw = String(first(searchParams.commune) || '').trim();
  const communeCity = cityOfCommune(communeRaw);
  let commune = communeCity ? communeRaw : null;
  if (commune && ville && communeCity !== ville) commune = null;
  if (commune && !ville) ville = communeCity;

  const offreRaw = String(first(searchParams.offre) || '').trim();
  const offre = DIRECTORY_OFFERS.includes(offreRaw) ? offreRaw : null;

  const verifies = first(searchParams.verifies) === '1';

  const triRaw = String(first(searchParams.tri) || '').trim();
  const tri = DIRECTORY_SORTS.includes(triRaw) ? triRaw : 'listings';

  const pageRaw = Number.parseInt(first(searchParams.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.min(pageRaw, 500) : 1;

  return { q, ville, commune, offre, verifies, tri, page };
}

/** True when anything narrows the list (the page is then `noindex`). */
export function hasDirectoryFilters(params) {
  return Boolean(params.q || params.ville || params.commune || params.offre || params.verifies || params.page > 1);
}

/**
 * The /agents URL for `params` with `changes` applied. Defaults are left out;
 * any change other than the page itself goes back to page 1.
 */
export function directoryHref(params, changes = {}) {
  const next = { ...params, ...changes };
  if (!('page' in changes)) next.page = 1;
  if ('ville' in changes && changes.ville !== params.ville && !('commune' in changes)) next.commune = null;

  const query = new URLSearchParams();
  if (next.q) query.set('q', next.q);
  if (next.ville) query.set('ville', next.ville);
  if (next.commune) query.set('commune', next.commune);
  if (next.offre) query.set('offre', next.offre);
  if (next.verifies) query.set('verifies', '1');
  if (next.tri && next.tri !== 'listings') query.set('tri', next.tri);
  if (next.page > 1) query.set('page', String(next.page));
  const text = query.toString();
  return text ? `/agents?${text}` : '/agents';
}

/** City names, in the data's order (Kinshasa first). */
export function directoryCityNames() {
  return CITIES.map((c) => c.name);
}

/**
 * The card's heading and sub-line. A person's name leads; the agency follows.
 * Never `agents.username` (it is the phone number) and never a phone-shaped
 * agency name.
 */
export function directoryAgentName(row) {
  const person = [row.first_name, row.last_name].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const agency = displayableAgencyName(row.agency_name) || publicVendorName(row.vendor_name);
  if (person) return { name: person, agency: agency && agency !== person ? agency : null };
  if (agency) return { name: agency, agency: null };
  return { name: null, agency: null };
}

/** vendorNameSql's "Agence #12" placeholder is a console label, not a name to publish. */
function publicVendorName(value) {
  const name = displayableAgencyName(value);
  return name && !/^Agence #\d+$/.test(name) ? name : null;
}

/** Lower-case, accents removed — the same fold the SQL applies with translate(). */
export function foldSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
