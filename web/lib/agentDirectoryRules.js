/**
 * Public agent directory (/agents) — the pure half: what the URL asks for,
 * how a link changes it, how a typed place becomes communes, which communes
 * are nearest a point, and how an agent is named on a card. The SQL is in
 * lib/agentDirectory.js. Tests: tests/unit/agent-directory.test.js.
 *
 * Every filter lives in the URL (GET form and links, no client state), so a
 * search is one server render, works with JavaScript off on a slow phone, and
 * can be shared on WhatsApp as a link.
 *
 * Server-only in practice: it pulls in the Kinshasa gazetteer (~100 KB of
 * JSON). Client components get what they need as props.
 */
import { CITIES, DEFAULT_CITY, findCity, cityOfCommune, findCityMention, findCommuneInCity } from './cities';
import { findLocationMention } from './gazetteer';
import { displayableAgencyName } from './agentIdentity';

export { nearestCommunes, NEAR_ME_MAX_KM, NEAR_ME_MAX_COMMUNES } from './nearestCommunes';

/** One page of cards. Small enough for a 3G phone, large enough to scroll. */
export const DIRECTORY_PAGE_SIZE = 24;

export const DIRECTORY_SORTS = ['listings', 'rating', 'recent'];
export const DIRECTORY_OFFERS = ['location', 'vente'];

/** Same cap as a listings search (lib/searchParser.js MAX_SEARCH_COMMUNES). */
export const MAX_DIRECTORY_COMMUNES = 5;

/** Search box cap: a name, not an essay. */
const MAX_QUERY_LENGTH = 60;


function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’-]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words a visitor puts around a place name ("à Righini", "près de l'UPN"). */
const PLACE_FILLER = new Set([
  'a', 'au', 'aux', 'en', 'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'pres', 'vers', 'cote', 'quartier', 'commune',
  'ville', 'agent', 'agents', 'agence', 'agences', 'immobilier', 'immobiliers', 'dans', 'sur', 'near', 'in', 'at',
]);

/** True when `text` holds nothing but `matched` and filler words. */
function onlyPlace(text, matched) {
  const rest = ` ${fold(text)} `.replace(` ${fold(matched)} `, ' ');
  return rest.split(' ').filter(Boolean).every((word) => PLACE_FILLER.has(word));
}

/**
 * The search box's text, read as a place when it is nothing else: a city
 * ("Lubumbashi"), a commune of any city ("Kampemba"), or a Kinshasa quartier,
 * alias or landmark from the gazetteer ("Righini" → Lemba, "UPN" → Ngaliema).
 * A quartier several communes share (Salongo) gives all of them. Anything with
 * another word left over ("Agence Matonge") stays a name search.
 *
 * @returns {{ville: string, communes: string[], label: string}|null}
 */
export function resolvePlaceQuery(text) {
  if (!fold(text)) return null;

  const city = findCityMention(text);
  if (city && onlyPlace(text, city.matchedText)) return { ville: city.city.name, communes: [], label: city.city.name };
  if (onlyPlace(text, DEFAULT_CITY)) return { ville: DEFAULT_CITY, communes: [], label: DEFAULT_CITY };

  const other = findCommuneInCity(text);
  if (other && onlyPlace(text, other.matchedText)) return { ville: other.city, communes: [other.key], label: other.matchedText };

  const place = findLocationMention(text);
  if (place && onlyPlace(text, place.matchedText)) {
    const communes = [place.commune, ...(place.alsoIn || [])].filter((key) => cityOfCommune(key) === DEFAULT_CITY);
    if (communes.length > 0) {
      return { ville: DEFAULT_CITY, communes: [...new Set(communes)].slice(0, MAX_DIRECTORY_COMMUNES), label: place.label };
    }
  }
  return null;
}

/** `?communes=Gombe,Ngaliema` and the older single `?commune=Gombe`, as real keys. */
function readCommunes(searchParams) {
  const raw = [first(searchParams.communes), first(searchParams.commune)]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter((key) => cityOfCommune(key));
  return [...new Set(raw)].slice(0, MAX_DIRECTORY_COMMUNES);
}

/** The one city every commune belongs to, or null when they span several. */
function cityOfAll(communes) {
  const cities = new Set(communes.map(cityOfCommune));
  return cities.size === 1 ? [...cities][0] : null;
}

/**
 * @param {Record<string, string|string[]|undefined>} searchParams
 * @returns {{q: string, nom: boolean, place: {label: string}|null, ville: string|null, communes: string[], pres: boolean,
 *   offre: string|null, verifies: boolean, tri: string, page: number}}
 */
export function parseDirectoryParams(searchParams = {}) {
  const q = String(first(searchParams.q) || '').trim().slice(0, MAX_QUERY_LENGTH);
  // `nom=1`: the visitor asked to search the text as a name even though it
  // reads as a place ("Kimbangu" is a quartier and a surname).
  const nom = first(searchParams.nom) === '1';

  const city = findCity(first(searchParams.ville));
  let ville = city ? city.name : null;
  let communes = readCommunes(searchParams);
  let place = null;

  const resolved = q && !nom ? resolvePlaceQuery(q) : null;
  if (resolved) {
    // The typed place decides the area; the menus' choice gives way to it.
    ville = resolved.ville;
    communes = resolved.communes;
    place = { label: resolved.label };
  } else if (ville) {
    communes = communes.filter((key) => cityOfCommune(key) === ville);
  } else if (communes.length > 0) {
    ville = cityOfAll(communes);
  }

  const pres = !place && communes.length > 0 && first(searchParams.pres) === '1';

  const offreRaw = String(first(searchParams.offre) || '').trim();
  const offre = DIRECTORY_OFFERS.includes(offreRaw) ? offreRaw : null;

  const verifies = first(searchParams.verifies) === '1';

  const triRaw = String(first(searchParams.tri) || '').trim();
  const tri = DIRECTORY_SORTS.includes(triRaw) ? triRaw : 'listings';

  const pageRaw = Number.parseInt(first(searchParams.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.min(pageRaw, 500) : 1;

  return { q, nom, place, ville, communes, pres, offre, verifies, tri, page };
}

/** The name filter applies only when the text was not read as a place. */
export function nameQuery(params) {
  return params.place ? '' : params.q;
}

/** True when anything narrows the list (the page is then `noindex`). */
export function hasDirectoryFilters(params) {
  return Boolean(
    params.q || params.ville || params.communes.length || params.offre || params.verifies || params.page > 1,
  );
}

/**
 * The /agents URL for `params` with `changes` applied. Defaults are left out;
 * any change other than the page itself goes back to page 1. A new city drops
 * communes of another city, and choosing communes drops a typed place (the
 * chips then decide the area, not the text).
 */
export function directoryHref(params, changes = {}) {
  const next = { ...params, ...changes };
  if (!('page' in changes)) next.page = 1;
  if ('ville' in changes && changes.ville !== params.ville && !('communes' in changes)) {
    next.communes = changes.ville ? params.communes.filter((key) => cityOfCommune(key) === changes.ville) : params.communes;
  }
  if (('communes' in changes || 'ville' in changes) && params.place && !changes.nom) next.q = '';
  if (!('pres' in changes)) next.pres = false;

  const query = new URLSearchParams();
  if (next.q) query.set('q', next.q);
  if (next.q && next.nom) query.set('nom', '1');
  if (next.ville) query.set('ville', next.ville);
  if (next.communes?.length) query.set('communes', next.communes.join(','));
  if (next.pres && next.communes?.length) query.set('pres', '1');
  if (next.offre) query.set('offre', next.offre);
  if (next.verifies) query.set('verifies', '1');
  if (next.tri && next.tri !== 'listings') query.set('tri', next.tri);
  if (next.page > 1) query.set('page', String(next.page));
  const text = query.toString();
  return text ? `/agents?${text}` : '/agents';
}

/**
 * The link a commune chip carries: adds it, or removes it when it is already
 * chosen. Null when adding would pass the cap (the chip is then shown inert).
 * The communes the place search chose become chips the visitor can trim.
 */
export function toggleCommuneHref(params, key) {
  const chosen = params.communes;
  if (chosen.includes(key)) return directoryHref(params, { communes: chosen.filter((c) => c !== key) });
  if (chosen.length >= MAX_DIRECTORY_COMMUNES) return null;
  const communes = [...chosen, key];
  return directoryHref(params, { communes, ville: params.ville || cityOfCommune(key) });
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
