/**
 * Real-world spelling variants for free-text landmark/place search — shared
 * between lib/listings.js (server, builds the ILIKE fallback) and
 * lib/listingView.js (client-reachable, highlights where a match landed on
 * a listing card). Lives outside lib/listings.js on purpose: that file is
 * `server-only`, and importing it from a client component would fail the
 * build — this file has no DB/server dependency at all, just string
 * manipulation, so it's safe on both sides.
 */

/**
 * "St"/"Ste" <-> "Saint"/"Sainte" is a generic French abbreviation, not a
 * fact about any one place — an agent writing a listing description might
 * spell a landmark any of four real ways ("St Luc", "St-Luc", "Saint Luc",
 * "Saint-Luc"), and ILIKE is a literal substring match that bridges none of
 * those differences on its own. Global (not just the first occurrence),
 * feminine-aware (Ste/Sainte), and covers both a space and a hyphen
 * separator regardless of which one the input actually used — the earlier
 * version only ever produced spaced variants, so a hyphenated original
 * ("St-Luc") never matched a spaced query ("Saint Luc") or vice versa.
 */
export function abbreviationVariants(term) {
  const variants = new Set([term]);

  const PATTERN = /\b(st|ste|saint|sainte)\.?[\s-]+(?=\S)/gi;
  const forms = [
    ['Saint', 'Sainte', ' '],
    ['Saint', 'Sainte', '-'],
    ['St', 'Ste', ' '],
    ['St', 'Ste', '-'],
  ];
  for (const [long, longFeminine, sep] of forms) {
    const variant = term.replace(PATTERN, (match, prefix) => `${/^(ste|sainte)$/i.test(prefix) ? longFeminine : long}${sep}`);
    if (variant !== term) variants.add(variant);
  }

  return Array.from(variants);
}
