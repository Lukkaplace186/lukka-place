import { findCountry, countryForNumber } from './countries';

/**
 * International phone number normalization for customer/agent accounts.
 *
 * Pure, no `server-only` — used both server-side (login/signup lookups) and
 * client-side (display formatting on /compte). Returns the digits-only
 * `wa_id` form this system already uses everywhere else (see
 * routes/admin.js's `/^\d{9,15}$/` gate on `POST /admin/send-whatsapp`) —
 * never a `+`-prefixed string, and never the 32-bit-`integer` mistake
 * `CLAUDE.md`'s Known Gaps documents for the original `agents.phone` column.
 *
 * Most of this user base is in Kinshasa and types a DRC number without a
 * country code — the three shapes below (with '243', with the local trunk
 * '0', or bare) are preserved exactly as before so that UX doesn't regress.
 * A visitor from anywhere else is expected to type a real E.164 number with
 * its leading '+' (e.g. '+33612345678', '+15551234567'): that's the one
 * unambiguous signal that the digits that follow already include a real
 * country code, so this only accepts an international number when '+' is
 * present — a bare non-DRC-shaped digit string is otherwise indistinguishable
 * from a mistyped DRC number, so it's rejected rather than guessed at.
 *
 * Since the platform opened to international customers and agents, every
 * real form passes the country the visitor picked (see
 * components/PhoneField.js, which posts a `<name>Country` ISO-3166 code
 * beside the number) — that is the unambiguous signal this function used to
 * lack, and `normalizeInCountry` below handles it. The country-less path
 * here is unchanged and still the fallback for a bare number arriving
 * without one (an old bookmarked link, the WhatsApp intake pipeline).
 *
 * @param {string} input
 * @param {string} [countryIso2] ISO 3166-1 alpha-2 of the picked country.
 * @returns {string|null} Digits-only, or null when the input doesn't
 *   confidently match a real number.
 */
export function normalizePhone(input, countryIso2) {
  const country = findCountry(countryIso2);
  if (country) return normalizeInCountry(input, country);

  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (raw.startsWith('+')) {
    return /^\d{9,15}$/.test(digits) ? digits : null;
  }

  if (digits.startsWith('243') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `243${digits.slice(1)}`;
  if (!digits.startsWith('0') && digits.length === 9) return `243${digits}`;

  return null;
}

/**
 * The Server-Action-side counterpart of components/PhoneField.js, which
 * posts the typed number as `name` and the picked country as `<name>Country`.
 * One helper so no call site can read the number and forget the country —
 * which would silently fall back to the DRC-shaped guess for every
 * international visitor.
 *
 * @param {FormData} formData
 * @param {string} [name]
 * @returns {string|null} digits-only E.164, or null
 */
export function phoneFromForm(formData, name = 'phone') {
  return normalizePhone(String(formData.get(name) || ''), String(formData.get(`${name}Country`) || ''));
}

// E.164 caps the whole number at 15 digits; the shortest real one is a
// 3-digit country code plus a 4-digit subscriber number (e.g. St Helena).
const MIN_E164_LENGTH = 7;
const MAX_E164_LENGTH = 15;

// Below this, a "national number" is too short to be one — which is what
// keeps a trunk-prefix strip from eating the only meaningful digit of a
// half-typed entry.
const MIN_NATIONAL_LENGTH = 6;

/**
 * The path taken whenever the visitor actually picked a country. The country
 * code is then a fact, not a guess, so the three shapes people really type
 * all resolve to the same E.164 number:
 *
 *   country GB + '07932 673460'  -> '447932673460'  (national, trunk 0)
 *   country GB + '7932 673460'   -> '447932673460'  (national, no trunk)
 *   country GB + '+44 7932 673460' or '00 44 …' or '44 …' -> same
 *
 * A leading '+' or an international prefix ('00', or '011' across the NANP)
 * wins over the picked country rather than being stripped and re-prefixed:
 * someone who typed a full international number meant that number, even if
 * the dropdown beside it still says something else.
 */
function normalizeInCountry(input, country) {
  const raw = String(input || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (raw.startsWith('+')) return inRange(digits);

  if (digits.startsWith('00')) return inRange(digits.slice(2));
  if (country.trunk === '1' && digits.startsWith('011')) return inRange(digits.slice(3));

  if (country.trunk && digits.startsWith(country.trunk)) {
    const withoutTrunk = digits.slice(country.trunk.length);
    if (withoutTrunk.length >= MIN_NATIONAL_LENGTH) digits = withoutTrunk;
  } else if (
    digits.startsWith(country.dial) &&
    digits.length - country.dial.length >= MIN_NATIONAL_LENGTH
  ) {
    // Already carries its country code (pasted from a contact card, typed
    // without the '+'). Prefixing the dial code again would double it.
    return inRange(digits);
  }

  return inRange(`${country.dial}${digits}`);
}

function inRange(digits) {
  return digits.length >= MIN_E164_LENGTH && digits.length <= MAX_E164_LENGTH ? digits : null;
}

/**
 * For values that are ALREADY digits-only E.164 — a `wa_id` out of the
 * WhatsApp pipeline, a phone read back off a row, the number carried in a
 * signed cookie. It validates the shape; it never guesses a country.
 *
 * This exists because normalizePhone() must NOT be used for that. Its
 * country-less branch is built to recognise DRC shorthand, so it accepts
 * '243997123456' and rejects '447932673460' — the moment non-DRC accounts
 * existed, re-normalizing a stored number would have turned every
 * international agent's activation link into "Lien expiré".
 *
 * @param {string} value
 * @returns {string|null}
 */
export function normalizeStoredPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= MIN_E164_LENGTH && digits.length <= MAX_E164_LENGTH ? digits : null;
}

/**
 * The inverse of the above: takes a stored digits-only number and returns
 * the `{ country, national }` pair a PhoneField needs to re-open it with the
 * right country selected and only the national part in the text input.
 *
 * A number we can't attribute to a country comes back with `country: null`
 * and the full digits as `national` — the caller then shows it as typed
 * rather than silently reassigning it to a country it may not belong to.
 *
 * @param {string} normalized digits-only E.164
 * @returns {{country: string|null, national: string}}
 */
export function splitPhone(normalized) {
  const digits = String(normalized || '').replace(/\D/g, '');
  if (!digits) return { country: null, national: '' };
  const country = countryForNumber(digits);
  if (!country) return { country: null, national: digits };
  return { country: country.iso2, national: digits.slice(country.dial.length) };
}

/**
 * '243997123456' -> '+243 99 712 3456' for the DRC shape this app's own
 * users are overwhelmingly in; any other real E.164 number is shown as
 * '+<digits>' rather than the old behaviour of returning the bare
 * unformatted digit string (which read as a stray number with no country
 * marker at all once non-DRC signups became possible).
 */
export function formatPhoneDisplay(normalized) {
  const digits = String(normalized || '');
  if (!digits) return '';
  if (/^243\d{9}$/.test(digits)) {
    const rest = digits.slice(3);
    return `+243 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
  }
  // Any other country: split the dial code off so it reads as an
  // international number rather than one long digit run. No per-country
  // national grouping is applied — we hold no such rules, and inventing
  // groupings would misrepresent how the owner writes their own number.
  const { country, national } = splitPhone(digits);
  return country && national ? `+${findCountry(country).dial} ${national}` : `+${digits}`;
}
