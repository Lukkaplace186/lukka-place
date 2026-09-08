import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

/**
 * **Every heading in this product starts with a capital letter.**
 *
 * That is the whole rule, and it is a rule rather than a review habit
 * because headings arrive from three places that no single reviewer sees at
 * once: a key added to fr.json, its English counterpart added later by
 * someone else, and the occasional heading written straight into JSX. A
 * lowercase one reads as a typo on a page nobody was looking at.
 *
 * Deliberately narrow. It checks the FIRST character only — it says nothing
 * about sentence case vs title case within a heading, because the two are
 * both in use here on purpose (French section titles are sentence case,
 * some product-name headings are title case) and a test that picked a winner
 * would be inventing an editorial decision nobody made.
 *
 * Three things are legitimately not capital letters at the start of a
 * heading and are allowed: a digit ("2 chambres"), an interpolation the
 * value fills in ("{count} annonces"), and punctuation. `.u-eyebrow`
 * micro-labels are uppercased in CSS regardless, but their source strings
 * are held to the same rule so the dictionary reads consistently.
 */

const ROOT = process.cwd();

/**
 * A heading string is fine if its first letter-bearing character is
 * uppercase.
 *
 * A template that OPENS with an interpolation is exempt here, because the
 * capital comes from the substituted value rather than from the template —
 * `listings.results.heading` is "{subject} {transaction} in {place}", and it
 * renders "Apartments to rent in Gombe". Exempting it silently would leave a
 * real heading unchecked, so the values that can open it are asserted
 * separately below.
 */
function startsCapitalized(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('{')) return true; // opened by data — checked at its source
  const m = trimmed.match(/^[^\p{L}]*(\p{L})/u);
  if (!m) return true; // no letters at all — nothing to capitalize
  return m[1] === m[1].toLocaleUpperCase();
}

/**
 * Keys whose values are headings. Two sources, unioned:
 *   - naming convention (`…title`, `…Title`, `…heading`, `…eyebrow`)
 *   - keys this app actually renders inside an <h1>–<h6>, read out of the JSX
 */
function conventionKeys(dict) {
  const out = [];
  (function walk(node, prefix) {
    for (const [key, value] of Object.entries(node)) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') walk(value, keyPath);
      else if (typeof value === 'string' && /(title|heading|eyebrow)$/i.test(key)) out.push(keyPath);
    }
  })(dict, '');
  return out;
}

function sourceFiles() {
  return execSync('find app components -name "*.js" -o -name "*.jsx"', { encoding: 'utf8', cwd: ROOT })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((f) => f.split(path.sep).join('/'));
}

/** `<h2 ...>{t('a.b.c')}` — the key, wherever a heading element renders one. */
function headingKeysInSource() {
  const keys = new Set();
  for (const file of sourceFiles()) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/<h[1-6][^>]*>\s*\{\s*t\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  }
  return [...keys];
}

function lookup(dict, keyPath) {
  return keyPath.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

for (const [lang, dict] of [['fr', fr], ['en', en]]) {
  test(`${lang}.json: every heading string starts with a capital letter`, () => {
    const keys = [...new Set([...conventionKeys(dict), ...headingKeysInSource()])].sort();
    // A key read out of the JSX may legitimately be absent from a dictionary
    // (i18n.test.js is what owns fr/en parity); only check what resolves to
    // a real string here.
    const offenders = keys
      .map((key) => [key, lookup(dict, key)])
      .filter(([, value]) => typeof value === 'string')
      .filter(([, value]) => !startsCapitalized(value));

    assert.deepEqual(
      offenders.map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
      [],
      `${lang}.json headings must start with a capital letter`,
    );
  });
}

test('headings written straight into JSX start with a capital letter', () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/<h[1-6][^>]*>([^<{]*\p{L}[^<{]*)/gu)) {
      if (!startsCapitalized(m[1])) offenders.push(`${file}: ${m[1].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'literal JSX headings must start with a capital letter');
});

/**
 * The one heading in this app assembled from a template that opens with an
 * interpolation (`listings.results.heading`, rendered by
 * components/ResultsHeader.js). Its first word is whichever plural property
 * label the filters produced, or the fallback subject — so those are the
 * strings that decide whether that <h1> starts with a capital.
 */
for (const [lang, dict] of [['fr', fr], ['en', en]]) {
  test(`${lang}.json: values that open the results heading start with a capital`, () => {
    const openers = {
      'listings.results.subjectFallback': lookup(dict, 'listings.results.subjectFallback'),
      ...Object.fromEntries(
        Object.entries(lookup(dict, 'listings.typePlurals') || {}).map(([k, v]) => [`listings.typePlurals.${k}`, v]),
      ),
    };

    const offenders = Object.entries(openers)
      .filter(([, value]) => typeof value === 'string' && !startsCapitalized(value))
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`);

    assert.deepEqual(offenders, [], `${lang}.json: results-heading openers must start with a capital letter`);
  });
}
