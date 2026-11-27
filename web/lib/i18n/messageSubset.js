/**
 * Which part of the dictionary a layout hands the browser (2026-11-21).
 *
 * A layout lists ENTRIES: a whole namespace (`'listings'`) or a dot-path inside
 * one (account.limits, auth.nudge). A dot-path ships only that subtree,
 * which is how the public shell carries the three account.limits strings
 * AccountLimitNotice renders without the other ~40 KB of `account` copy the
 * Espace Client needs. Pure — no React, no `next/headers` — so the server
 * (getMessages), the browser (I18nProvider's merge) and the tests share it.
 *
 * tests/unit/i18n-namespaces.test.js checks every key a client component can
 * resolve against what its layouts ship, dot-paths included.
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge, `b` winning on a conflict. Nested providers merge this way, so a
 * parent shipping account.limits and a child shipping the whole account
 * end up with the whole namespace, and two partial subtrees of one namespace
 * both survive.
 */
export function mergeMessages(a, b) {
  if (!isPlainObject(a)) return isPlainObject(b) ? b : (b ?? a);
  if (!isPlainObject(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeMessages(out[key], value) : value;
  }
  return out;
}

/** The subtree at `path` ('a.b.c'), or undefined. */
function at(dictionary, path) {
  let node = dictionary;
  for (const segment of path.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[segment];
  }
  return node;
}

/** `{ a: { b: { c: value } } }` for 'a.b.c'. */
function nest(path, value) {
  return path.split('.').reduceRight((inner, segment) => ({ [segment]: inner }), value);
}

/**
 * Picks the listed entries out of a dictionary. An entry that names nothing is
 * skipped (the namespace test catches a typo, not this). No list = everything.
 */
export function pickMessages(dictionary, entries) {
  if (!entries) return dictionary;
  let picked = {};
  for (const entry of entries) {
    const value = at(dictionary, entry);
    if (value === undefined) continue;
    picked = mergeMessages(picked, nest(entry, value));
  }
  return picked;
}
