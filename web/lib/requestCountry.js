import 'server-only';
import { headers } from 'next/headers';
import { DEFAULT_COUNTRY, regionFromLocaleTag } from './countries';

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
  // The rule itself (a region that is just its language's default — fr-FR,
  // en-US — says nothing) lives in lib/countries.js, shared with the
  // browser's check in components/PhoneField.js.
  for (const part of acceptLanguage.split(',')) {
    const region = regionFromLocaleTag(part.split(';')[0].trim());
    if (region) return region;
  }

  return DEFAULT_COUNTRY;
}
