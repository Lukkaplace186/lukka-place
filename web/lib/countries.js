/**
 * ITU-T E.164 country calling codes, for the country-code picker on every
 * phone field (components/PhoneField.js) and for the country-aware half of
 * lib/phone.js's normalizePhone.
 *
 * Pure data + pure helpers, no `server-only`: the picker is a client
 * component and the Server Actions normalize the same numbers server-side,
 * so both realms import this.
 *
 * **Country names are not stored here.** `Intl.DisplayNames` resolves them
 * from the platform's own ICU data in whatever locale the visitor is
 * reading, which is both more accurate and more honest than 230 hand-typed
 * French strings and 230 hand-typed English ones drifting apart — and it is
 * exactly the FR/EN parity problem lib/i18n would otherwise inherit for a
 * list nobody on this team maintains. `regionName()` below is the only
 * accessor; it falls back to the raw ISO code if a runtime somehow ships
 * without region display names.
 *
 * The `trunk` field is the national trunk prefix a local caller dials before
 * the subscriber number and which is NOT part of the E.164 number — '0' for
 * most of the world (a UK number written 07932 673460 is +44 7932 673460),
 * '1' across the North American Numbering Plan. `''` marks the countries
 * where a leading 0 genuinely belongs to the national number and must be
 * kept: Italy (fixed lines: +39 06… for Rome) and Côte d'Ivoire (10-digit
 * numbering since 2021: +225 07…). Getting that wrong silently deletes a
 * real digit, so it is a per-country fact here rather than a blanket rule.
 */

/** @typedef {{iso2: string, dial: string, trunk: string}} Country */

// [ISO 3166-1 alpha-2, E.164 calling code]. Trunk prefix defaults to '0';
// the two maps below carry the real exceptions.
const DIAL_CODES = [
  ['AF', '93'], ['AL', '355'], ['DZ', '213'], ['AS', '1'], ['AD', '376'],
  ['AO', '244'], ['AI', '1'], ['AG', '1'], ['AR', '54'], ['AM', '374'],
  ['AW', '297'], ['AU', '61'], ['AT', '43'], ['AZ', '994'], ['BS', '1'],
  ['BH', '973'], ['BD', '880'], ['BB', '1'], ['BY', '375'], ['BE', '32'],
  ['BZ', '501'], ['BJ', '229'], ['BM', '1'], ['BT', '975'], ['BO', '591'],
  ['BA', '387'], ['BW', '267'], ['BR', '55'], ['IO', '246'], ['VG', '1'],
  ['BN', '673'], ['BG', '359'], ['BF', '226'], ['BI', '257'], ['KH', '855'],
  ['CM', '237'], ['CA', '1'], ['CV', '238'], ['KY', '1'], ['CF', '236'],
  ['TD', '235'], ['CL', '56'], ['CN', '86'], ['CO', '57'], ['KM', '269'],
  ['CG', '242'], ['CD', '243'], ['CK', '682'], ['CR', '506'], ['CI', '225'],
  ['HR', '385'], ['CU', '53'], ['CW', '599'], ['CY', '357'], ['CZ', '420'],
  ['DK', '45'], ['DJ', '253'], ['DM', '1'], ['DO', '1'], ['EC', '593'],
  ['EG', '20'], ['SV', '503'], ['GQ', '240'], ['ER', '291'], ['EE', '372'],
  ['SZ', '268'], ['ET', '251'], ['FK', '500'], ['FO', '298'], ['FJ', '679'],
  ['FI', '358'], ['FR', '33'], ['GF', '594'], ['PF', '689'], ['GA', '241'],
  ['GM', '220'], ['GE', '995'], ['DE', '49'], ['GH', '233'], ['GI', '350'],
  ['GR', '30'], ['GL', '299'], ['GD', '1'], ['GP', '590'], ['GU', '1'],
  ['GT', '502'], ['GG', '44'], ['GN', '224'], ['GW', '245'], ['GY', '592'],
  ['HT', '509'], ['HN', '504'], ['HK', '852'], ['HU', '36'], ['IS', '354'],
  ['IN', '91'], ['ID', '62'], ['IR', '98'], ['IQ', '964'], ['IE', '353'],
  ['IM', '44'], ['IL', '972'], ['IT', '39'], ['JM', '1'], ['JP', '81'],
  ['JE', '44'], ['JO', '962'], ['KZ', '7'], ['KE', '254'], ['KI', '686'],
  ['XK', '383'], ['KW', '965'], ['KG', '996'], ['LA', '856'], ['LV', '371'],
  ['LB', '961'], ['LS', '266'], ['LR', '231'], ['LY', '218'], ['LI', '423'],
  ['LT', '370'], ['LU', '352'], ['MO', '853'], ['MG', '261'], ['MW', '265'],
  ['MY', '60'], ['MV', '960'], ['ML', '223'], ['MT', '356'], ['MH', '692'],
  ['MQ', '596'], ['MR', '222'], ['MU', '230'], ['YT', '262'], ['MX', '52'],
  ['FM', '691'], ['MD', '373'], ['MC', '377'], ['MN', '976'], ['ME', '382'],
  ['MS', '1'], ['MA', '212'], ['MZ', '258'], ['MM', '95'], ['NA', '264'],
  ['NR', '674'], ['NP', '977'], ['NL', '31'], ['NC', '687'], ['NZ', '64'],
  ['NI', '505'], ['NE', '227'], ['NG', '234'], ['NU', '683'], ['NF', '672'],
  ['KP', '850'], ['MK', '389'], ['MP', '1'], ['NO', '47'], ['OM', '968'],
  ['PK', '92'], ['PW', '680'], ['PS', '970'], ['PA', '507'], ['PG', '675'],
  ['PY', '595'], ['PE', '51'], ['PH', '63'], ['PL', '48'], ['PT', '351'],
  ['PR', '1'], ['QA', '974'], ['RE', '262'], ['RO', '40'], ['RU', '7'],
  ['RW', '250'], ['BL', '590'], ['SH', '290'], ['KN', '1'], ['LC', '1'],
  ['MF', '590'], ['PM', '508'], ['VC', '1'], ['WS', '685'], ['SM', '378'],
  ['ST', '239'], ['SA', '966'], ['SN', '221'], ['RS', '381'], ['SC', '248'],
  ['SL', '232'], ['SG', '65'], ['SX', '1'], ['SK', '421'], ['SI', '386'],
  ['SB', '677'], ['SO', '252'], ['ZA', '27'], ['KR', '82'], ['SS', '211'],
  ['ES', '34'], ['LK', '94'], ['SD', '249'], ['SR', '597'], ['SE', '46'],
  ['CH', '41'], ['SY', '963'], ['TW', '886'], ['TJ', '992'], ['TZ', '255'],
  ['TH', '66'], ['TL', '670'], ['TG', '228'], ['TK', '690'], ['TO', '676'],
  ['TT', '1'], ['TN', '216'], ['TR', '90'], ['TM', '993'], ['TC', '1'],
  ['TV', '688'], ['UG', '256'], ['UA', '380'], ['AE', '971'], ['GB', '44'],
  ['US', '1'], ['UY', '598'], ['UZ', '998'], ['VU', '678'], ['VA', '39'],
  ['VE', '58'], ['VN', '84'], ['WF', '681'], ['EH', '212'], ['YE', '967'],
  ['ZM', '260'], ['ZW', '263'],
];

/** Countries whose leading 0 is part of the national number, not a trunk prefix. */
const KEEPS_LEADING_ZERO = new Set(['IT', 'VA', 'CI']);

/** North American Numbering Plan: the national trunk prefix is '1', not '0'. */
const NANP_TRUNK = '1';

/** @type {Country[]} */
export const COUNTRIES = DIAL_CODES.map(([iso2, dial]) => ({
  iso2,
  dial,
  trunk: KEEPS_LEADING_ZERO.has(iso2) ? '' : dial === '1' ? NANP_TRUNK : '0',
}));

const BY_ISO2 = new Map(COUNTRIES.map((c) => [c.iso2, c]));

/**
 * The platform's home country. Every phone field defaults here unless the
 * visitor has picked something else before or their browser reports a
 * region we recognise — most of this user base still types a Kinshasa
 * number, and that must stay a zero-decision path.
 */
export const DEFAULT_COUNTRY = 'CD';

/**
 * Pinned to the top of the picker: the DRC itself, then the countries the
 * Congolese diaspora this platform is opening up to actually lives in.
 * Ordering, not filtering — every country in COUNTRIES is still reachable.
 */
export const SUGGESTED_COUNTRIES = ['CD', 'CG', 'BE', 'FR', 'GB', 'US', 'CA', 'ZA', 'AO', 'DE', 'CH', 'AE'];

/** @returns {Country|null} */
export function findCountry(iso2) {
  return BY_ISO2.get(String(iso2 || '').toUpperCase()) || null;
}

/**
 * Seven dial codes are shared by more than one country, and digits alone
 * cannot say which (+1 is the US, Canada and twenty-odd Caribbean
 * territories; +44 is the UK plus Jersey, Guernsey and the Isle of Man).
 * Rather than let list order decide — which silently labelled every British
 * number "Guernsey" and every American one "American Samoa" — each shared
 * code names the country the overwhelming majority of its numbers belong
 * to. This only affects which name and flag the picker shows when re-opening
 * a stored number; the number itself is identical either way, since the
 * countries sharing a code share an E.164 prefix by definition.
 *
 * tests/unit/phone-countries.test.js asserts every shared code appears here,
 * so adding a country that shares one can't quietly reintroduce the bug.
 */
export const PRIMARY_FOR_DIAL = {
  1: 'US',
  7: 'RU',
  39: 'IT',
  44: 'GB',
  212: 'MA',
  262: 'RE',
  590: 'GP',
};

/**
 * The country a digits-only E.164 number belongs to, by longest matching
 * dial code — used to re-open a stored number back into the picker.
 *
 * @returns {Country|null}
 */
export function countryForNumber(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  if (!value) return null;
  for (let length = 4; length >= 1; length -= 1) {
    const prefix = value.slice(0, length);
    const primary = PRIMARY_FOR_DIAL[prefix];
    if (primary) return findCountry(primary);
    const match = COUNTRIES.find((c) => c.dial === prefix);
    if (match) return match;
  }
  return null;
}

/**
 * Regional-indicator flag for an ISO 3166-1 alpha-2 code ('GB' -> 🇬🇧).
 *
 * Windows ships no flag-emoji font, so this renders there as the two letters
 * "GB" instead — which is exactly the ISO code chip the alternative design
 * would have drawn anyway, and is why no separate code chip is rendered
 * beside it. No image assets, no new dependency.
 */
export function flagEmoji(iso2) {
  const code = String(iso2 || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const displayNamesCache = new Map();

function displayNamesFor(locale) {
  if (displayNamesCache.has(locale)) return displayNamesCache.get(locale);
  let instance = null;
  try {
    instance = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    instance = null; // runtime without region display names — fall back to the ISO code
  }
  displayNamesCache.set(locale, instance);
  return instance;
}

/**
 * Localised country name. 'XK' (Kosovo) is not an ISO 3166-1 assignment and
 * ICU has no name for it, so it falls through to its own code — which is how
 * it is commonly labelled anyway.
 */
export function regionName(iso2, locale = 'fr') {
  const code = String(iso2 || '').toUpperCase();
  const names = displayNamesFor(locale);
  if (!names) return code;
  try {
    return names.of(code) || code;
  } catch {
    return code;
  }
}

/** Diacritic- and case-insensitive haystack, so "cote divoire" finds Côte d'Ivoire. */
export function searchKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
