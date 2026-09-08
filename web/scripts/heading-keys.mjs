import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * "Which dictionary strings are headings?" — one answer, imported by both
 * scripts/apply-title-case.mjs (which rewrites them) and
 * tests/unit/heading-capitalization.test.js (which asserts they stayed
 * rewritten). Two copies of this would drift the first time a heading key
 * was named something the transform recognised and the test did not, and the
 * failure would be silent: a heading quietly not in Title Case.
 *
 * Two sources, unioned:
 *   - naming convention (`…title`, `…heading`, `…eyebrow`)
 *   - keys the app actually renders inside an <h1>–<h6>, read out of the JSX
 *     rather than listed by hand — a hardcoded list would need updating by
 *     the same person who forgot to update it.
 */

function isHeadingKey(key) {
  return /(title|heading|eyebrow)$/i.test(key) && !/subtitle$/i.test(key);
}

export function conventionKeys(dict) {
  const out = [];
  (function walk(node, prefix) {
    for (const [key, value] of Object.entries(node)) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') walk(value, keyPath);
      // `subtitle` ENDS IN `title` and would be swept in by the suffix match,
      // but a subtitle is body copy, not a heading — "List Your Properties and
      // Receive Customer Enquiries on WhatsApp." is not a sentence anyone
      // wants under a banner. Excluded explicitly.
      else if (typeof value === 'string' && isHeadingKey(key)) out.push(keyPath);
    }
  })(dict, '');
  return out;
}

export function sourceFiles(root) {
  return execSync('find app components -name "*.js" -o -name "*.jsx"', { encoding: 'utf8', cwd: root })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((f) => f.split(path.sep).join('/'));
}

/** `<h2 ...>{t('a.b.c')}` — the key, wherever a heading element renders one. */
export function headingKeysInSource(root) {
  const keys = new Set();
  for (const file of sourceFiles(root)) {
    const src = readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/<h[1-6][^>]*>\s*\{\s*t\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  }
  return [...keys];
}

/** Every heading key in `dict`, from both sources, sorted and de-duplicated. */
export function allHeadingKeys(dict, root) {
  return [...new Set([...conventionKeys(dict), ...headingKeysInSource(root)])].sort();
}

export function lookup(dict, keyPath) {
  return keyPath.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

export function setIn(dict, keyPath, value) {
  const parts = keyPath.split('.');
  const last = parts.pop();
  const parent = parts.reduce((node, part) => node[part], dict);
  parent[last] = value;
}
