import 'server-only';
import { headers } from 'next/headers';
import { DEFAULT_COUNTRY, findCountry } from './countries';

/**
 * The country a phone field should open on, decided on the server so the
 * very first byte of HTML already carries the right dial code.
 *
 * Without this, the server renders the platform default (+243) and the
 * browser swaps it to the visitor's own country a moment after hydration —
 * confirmed live in the preview: a London visitor watched the field say
 * "+243" and then flip to "+44". Nothing was broken by that, but a field
 * that changes its answer under you the instant you look at it is exactly
 * the kind of jank that makes a form feel slow.
 *
 * `Accept-Language` is the signal, because it is the only one every browser
 * sends on the first request. It reports a language preference rather than a
 * location, so it is a good hint and never a claim: "fr-BE" means someone
 * reading French in Belgium, "en-GB" someone in the UK, and a bare "fr"
 * means nothing about location at all and is ignored rather than turned
 * into a guess. Whatever it produces is only the field's STARTING country —
 * a previous explicit choice (localStorage) and the visitor's own selection
 * both still win, in components/PhoneField.js.
 *
 * Deliberately not IP geolocation: no geo service is wired up here, and a
 * CDN geo header (`x-vercel-ip-country` and friends) is not read because
 * this app does not run behind a host that is known to set one — reading a
 * header nothing sets would be a branch that has never executed.
 */
export async function getRequestCountry() {
  const headerList = await headers();
  return countryFromAcceptLanguage(headerList.get('accept-language') || '');
}

/** The pure half of getRequestCountry(), separated so it can be tested. */
export function countryFromAcceptLanguage(acceptLanguage) {
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0].trim();
    if (!tag || tag === '*') continue;
    try {
      // Only a tag that CARRIES a region counts. `maximize()` would happily
      // turn a bare "fr" into "fr-Latn-FR", which is a language-data
      // likelihood, not a fact about this visitor — that is how a Congolese
      // visitor whose browser says "fr" would end up defaulted to France.
      const locale = new Intl.Locale(tag);
      const region = locale.region;
      // A region that is merely the language's own default says nothing
      // either: an Android phone set to "Français" sends fr-FR, one set to
      // "English" sends en-US, and most phones in Kinshasa are one of the two.
      // Taking those at face value opened the field on +33 / +1, and an agent
      // typing "081 234 5678" was stored as a French number, so their
      // verification and every alert went nowhere. en-GB, fr-BE, fr-CA… still
      // differ from their language's default and still count.
      const languageDefault = new Intl.Locale(locale.language).maximize().region;
      if (region && region === languageDefault) continue;
      if (region && findCountry(region)) return region.toUpperCase();
    } catch {
      // Malformed tag — try the next one rather than failing the render.
    }
  }

  return DEFAULT_COUNTRY;
}
