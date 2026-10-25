import { ALL_CITIES, DEFAULT_CITY, findCity, isAllCities } from './cities';
import { parseSearchQuery } from './searchParser';

/**
 * `/listings?city=Lubumbashi&location=Kampemba` → the URL the site really
 * uses, `/listings?ville=Lubumbashi&commune=Kampemba (Lubumbashi)` (owner,
 * 2026-10-24: accept both). The real names stay `ville` / `commune` /
 * `quartier` / `near` / `q`, because saved searches, WhatsApp alerts and the
 * landing pages' canonicals already use them; middleware.js redirects (308)
 * an alias URL onto them, so a link in either form opens the same page.
 *
 * - `city`: a known city (any case or slug), or "toutes" / "Toutes les
 *   villes" / "all" for every city. Kinshasa adds nothing (no `ville` IS
 *   Kinshasa). An unknown city is dropped rather than searched.
 * - `location`: free text read by the search box's own parser
 *   (lib/searchParser.js) — commune, quartier, landmark, or several. Inside
 *   another city it is read together with the city name, so "Kampemba" with
 *   city=Lubumbashi finds Lubumbashi's commune. Words that name no place stay
 *   a text search (`q`).
 * - An explicit `ville` / `commune` already in the URL wins over the alias.
 *
 * Pure. Returns the new query string, or null when there is no alias to read.
 */
const ALL_CITY_WORDS = new Set([ALL_CITIES, 'toutes les villes', 'all', 'all cities', 'tout', 'rdc']);

export function normaliseSearchAliases(searchParams) {
  const params = new URLSearchParams(searchParams);
  if (!params.has('city') && !params.has('location')) return null;

  const cityText = (params.get('city') || '').trim();
  const locationText = (params.get('location') || '').trim();
  params.delete('city');
  params.delete('location');

  let ville = null;
  if (cityText) {
    if (isAllCities(cityText) || ALL_CITY_WORDS.has(cityText.toLowerCase())) ville = ALL_CITIES;
    else ville = findCity(cityText)?.name || null;
  }
  if (ville && !params.has('ville') && ville !== DEFAULT_CITY) params.set('ville', ville);

  const placeAlreadySet = ['commune', 'communes', 'quartier', 'near'].some((key) => params.has(key));
  if (locationText && !placeAlreadySet) {
    const inOtherCity = ville && ville !== ALL_CITIES && ville !== DEFAULT_CITY;
    const parsed = parseSearchQuery(inOtherCity ? `${locationText} ${ville}` : locationText);
    if (parsed.commune) {
      params.set('commune', parsed.commune);
      if (parsed.communes?.length > 1) params.set('communes', parsed.communes.join(','));
      if (parsed.quartier) params.set('quartier', parsed.quartier);
    }
    if (parsed.near) params.set('near', parsed.near);
    // A city named in the text itself ("Goma") is the city searched, unless
    // the URL already said which one.
    if (parsed.ville && !params.has('ville')) params.set('ville', parsed.ville);
    // A Kinshasa place under "every city" is simply that place.
    if (parsed.commune && params.get('ville') === ALL_CITIES) params.delete('ville');
    if (parsed.keywords && !params.has('q')) params.set('q', parsed.keywords);
  }

  return params.toString();
}
