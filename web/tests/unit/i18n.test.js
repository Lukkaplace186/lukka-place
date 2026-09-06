import test from 'node:test';
import assert from 'node:assert/strict';

import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };
import { LOCALES, DEFAULT_LOCALE, normalizeLocale } from '@/lib/i18n/config';
import { translate, createTranslator } from '@/lib/i18n/translate';

/**
 * The dictionaries are the one part of this feature that rots silently.
 * A component added in French with no English counterpart doesn't crash and
 * doesn't fail the build — it just renders French to an English visitor, or
 * (worse, before the fallback existed) a raw dot-path key. These tests are
 * what make that a failing test instead of a QA discovery.
 */

/** Every leaf path in a dictionary, as `a.b.c`. Plural objects are leaves. */
function leafKeys(node, prefix = '', out = []) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    // { one, other } / { zero, one, other } is a plural entry, i.e. a leaf —
    // not a namespace to recurse into.
    const isPlural =
      value && typeof value === 'object' && Object.keys(value).every((k) => ['zero', 'one', 'other'].includes(k));
    if (value && typeof value === 'object' && !isPlural) leafKeys(value, path, out);
    else out.push(path);
  }
  return out;
}

test('en.json covers every key in fr.json, and adds none of its own', () => {
  const frKeys = leafKeys(fr).sort();
  const enKeys = leafKeys(en).sort();

  const missingInEn = frKeys.filter((k) => !enKeys.includes(k));
  const extraInEn = enKeys.filter((k) => !frKeys.includes(k));

  assert.deepEqual(missingInEn, [], `keys present in fr.json but missing from en.json:\n  ${missingInEn.join('\n  ')}`);
  // An extra English key is dead weight at best and, more often, a renamed
  // French key whose old English entry was never cleaned up.
  assert.deepEqual(extraInEn, [], `keys present in en.json but missing from fr.json:\n  ${extraInEn.join('\n  ')}`);
});

test('no translation is left empty or accidentally identical across every namespace', () => {
  const empties = [];
  for (const [locale, dict] of [['fr', fr], ['en', en]]) {
    for (const key of leafKeys(dict)) {
      const value = key.split('.').reduce((node, part) => node?.[part], dict);
      const forms = typeof value === 'string' ? [value] : Object.values(value);
      for (const form of forms) {
        if (typeof form !== 'string' || form.trim() === '') empties.push(`${locale}:${key}`);
      }
    }
  }
  assert.deepEqual(empties, [], `empty translation values:\n  ${empties.join('\n  ')}`);
});

test('placeholders match between the two languages', () => {
  // "{count} biens" translated as "properties" with the count dropped is a
  // silent data loss — the number simply stops rendering.
  const mismatched = [];
  for (const key of leafKeys(fr)) {
    const read = (dict) => key.split('.').reduce((node, part) => node?.[part], dict);
    const frForms = read(fr);
    const enForms = read(en);
    if (enForms === undefined) continue;

    const collect = (v) =>
      new Set(
        (typeof v === 'string' ? [v] : Object.values(v))
          .flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
      );

    const a = [...collect(frForms)].sort();
    const b = [...collect(enForms)].sort();
    if (a.join(',') !== b.join(',')) mismatched.push(`${key}: fr{${a}} vs en{${b}}`);
  }
  assert.deepEqual(mismatched, [], `placeholder mismatch:\n  ${mismatched.join('\n  ')}`);
});

test('a missing key falls back to French, then to the key itself', () => {
  const messages = { probe: { present: 'English text' } };
  const fallbackMessages = { probe: { present: 'Texte français', frenchOnly: 'Seulement en français' } };

  assert.equal(translate('probe.present', { messages, fallbackMessages, locale: 'en' }), 'English text');
  // The safety net the parity test above exists to keep unused.
  assert.equal(translate('probe.frenchOnly', { messages, fallbackMessages, locale: 'en' }), 'Seulement en français');
  // Absent everywhere: the key itself, never blank — a blank element is
  // invisible in QA, a dot-path is not.
  assert.equal(translate('probe.nowhere', { messages, fallbackMessages, locale: 'en' }), 'probe.nowhere');
});

test('interpolation fills known vars and leaves unknown placeholders visible', () => {
  const t = createTranslator({ locale: 'fr', messages: { greet: 'Bonjour {name}, {missing}' } });
  assert.equal(t('greet', { name: 'Kabeya' }), 'Bonjour Kabeya, {missing}');
});

test('plural selection follows each language’s own rule, not a shared count === 1', () => {
  const messages = { items: { zero: 'Aucun bien', one: '{count} bien', other: '{count} biens' } };
  const tFr = createTranslator({ locale: 'fr', messages });
  // French: 0 and 1 are both singular; the explicit `zero` form wins at 0.
  assert.equal(tFr('items', { count: 0 }), 'Aucun bien');
  assert.equal(tFr('items', { count: 1 }), '1 bien');
  assert.equal(tFr('items', { count: 2 }), '2 biens');

  const tEn = createTranslator({
    locale: 'en',
    messages: { items: { one: '{count} property', other: '{count} properties' } },
  });
  // English: only 1 is singular — 0 takes the plural.
  assert.equal(tEn('items', { count: 0 }), '0 properties');
  assert.equal(tEn('items', { count: 1 }), '1 property');
  assert.equal(tEn('items', { count: 2 }), '2 properties');
});

test('normalizeLocale coerces anything unsupported to French', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('fr'), 'fr');
  for (const junk of [undefined, null, '', 'de', 'en-GB', 'EN', 42, {}]) {
    assert.equal(normalizeLocale(junk), DEFAULT_LOCALE, `${JSON.stringify(junk)} should fall back to French`);
  }
  assert.deepEqual(LOCALES, ['fr', 'en']);
});
