/**
 * Congolese mobile numbers out of a Facebook group post or comment — the pure
 * half of the Facebook prospect pipeline (lib/facebookProspects.js stores them,
 * app/api/ingest/facebook-lead/route.js receives the posts).
 *
 * A number counts only when it carries a country code (+243, 00243, 243) or the
 * national trunk 0, followed by one of MOBILE_PREFIXES and seven more digits.
 * A bare nine digits is refused: "850 000 000 FC" is a price, not a phone.
 * Separators inside a number are spaces, dots and hyphens (at most three in a
 * row, never a line break), so "081 234 56 78", "+243 (0) 81-234-5678" and
 * "wa.me/243812345678" all read, and "0812345678/0998765432" reads as two.
 *
 * Pure, no `server-only`: the unit tier runs it directly.
 */

/** DRC mobile prefixes accepted, after the 0 / 243. */
export const MOBILE_PREFIXES = ['80', '81', '82', '83', '84', '85', '89', '90', '91', '97', '98', '99'];

const SEP = '[ .\\-\\u00a0\\u2011]{0,3}';

const PHONE_PATTERN = new RegExp(
  '(?<![\\d+])' +
    `(?:(?<cc>(?:\\+|00)[ .]?243|243)\\)?${SEP})?` +
    `(?<trunk>\\(0\\)|0)?${SEP}` +
    `\\(?(?<prefix>${MOBILE_PREFIXES.join('|')})\\)?` +
    `(?<rest>(?:${SEP}\\d){7})` +
    '(?!\\d)',
  'g',
);

/**
 * Every distinct Congolese mobile number in `text`, in order of appearance,
 * as `+243XXXXXXXXX`.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function extractCongoPhones(text) {
  const source = typeof text === 'string' ? text : '';
  const found = new Set();
  for (const match of source.matchAll(PHONE_PATTERN)) {
    const { cc, trunk, prefix, rest } = match.groups;
    if (!cc && !trunk) continue;
    found.add(`+243${prefix}${rest.replace(/\D/g, '')}`);
  }
  return [...found];
}

/** `+243812345678` → `243812345678`, the digits-only form agents.phone is compared in. */
export function phoneDigits(e164) {
  return String(e164 || '').replace(/\D/g, '');
}

/** The post's link if it is an http(s) URL, else null — it ends up in a CSV someone opens. */
export function cleanPostUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Longest post or comment thread accepted, by the API and the paste page alike. */
export const POST_TEXT_MAX = 20000;
