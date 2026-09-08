import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };
import { toTitleCase } from '@/lib/titleCase';
import { allHeadingKeys, lookup, sourceFiles } from '../../scripts/heading-keys.mjs';

/**
 * **Headings: capitalized in both languages, Title Case in English.**
 *
 * Two different rules on purpose, because the two languages have two
 * different conventions:
 *
 *   English  Title Case — "Create an Agent Account"
 *   French   sentence case — "Créer un compte agent"
 *
 * Forcing English Title Case onto French would produce "Créer Un Compte
 * Agent", which reads to a French speaker the way "create an agent account"
 * reads to an English one. So French is held to the weaker rule (starts with
 * a capital) and English to the stronger one.
 *
 * This is a rule rather than a review habit because headings arrive from
 * three places no single reviewer sees at once: a key added to fr.json, its
 * English counterpart added later by someone else, and the occasional
 * heading written straight into JSX.
 *
 * The rule (lib/titleCase.js) and the "which keys are headings" question
 * (scripts/heading-keys.mjs) are both shared with
 * scripts/apply-title-case.mjs, so the transform and this guard cannot drift.
 */

const ROOT = process.cwd();

/**
 * The weaker rule: the first letter-bearing character is uppercase.
 *
 * A template that OPENS with an interpolation is exempt here, because the
 * capital comes from the substituted value rather than the template —
 * `listings.results.heading` is "{subject} {transaction} in {place}" and
 * renders "Apartments to Rent in Gombe". Exempting it silently would leave a
 * real heading unchecked, so the values that can open it are asserted
 * separately at the bottom of this file.
 */
function startsCapitalized(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('{')) return true; // opened by data — checked at its source
  const m = trimmed.match(/^[^\p{L}]*(\p{L})/u);
  if (!m) return true; // no letters at all — nothing to capitalize
  return m[1] === m[1].toLocaleUpperCase();
}

for (const [lang, dict] of [['fr', fr], ['en', en]]) {
  test(`${lang}.json: every heading string starts with a capital letter`, () => {
    const offenders = allHeadingKeys(dict, ROOT)
      .map((key) => [key, lookup(dict, key)])
      .filter(([, value]) => typeof value === 'string' && !startsCapitalized(value))
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`);

    assert.deepEqual(offenders, [], `${lang}.json headings must start with a capital letter`);
  });
}

/**
 * The stronger rule, English only. Run `node scripts/apply-title-case.mjs`
 * to fix a failure here rather than editing by hand — that is the same
 * transform that produced the current strings.
 */
test('en.json: every heading string is in Title Case', () => {
  const offenders = allHeadingKeys(en, ROOT)
    .map((key) => [key, lookup(en, key)])
    .filter(([, value]) => typeof value === 'string' && toTitleCase(value) !== value)
    .map(([key, value]) => `${key}\n    is:     ${JSON.stringify(value)}\n    should: ${JSON.stringify(toTitleCase(value))}`);

  assert.deepEqual(
    offenders,
    [],
    'English headings must be Title Case — run `node scripts/apply-title-case.mjs`',
  );
});

/*
 * There is deliberately NO test asserting French is *not* Title Case.
 * The obvious version — "flag any French heading that survives toTitleCase
 * unchanged" — fires on every proper-noun meta title ("Contact — Lukka
 * Place", "Appartements. Villas. Terrains. Agences."), and keeping it green
 * would need a hand-maintained exception list that the next person would
 * have to update to add a page. A test that needs an exception list is worse
 * than the convention being enforced structurally, which it is:
 * scripts/apply-title-case.mjs only ever opens lib/i18n/en.json, so there is
 * no code path that could Title-Case the French dictionary by accident.
 */

test('headings written straight into JSX start with a capital letter', () => {
  const offenders = [];
  for (const file of sourceFiles(ROOT)) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/<h[1-6][^>]*>([^<{]*\p{L}[^<{]*)/gu)) {
      if (!startsCapitalized(m[1])) offenders.push(`${file}: ${m[1].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'literal JSX headings must start with a capital letter');
});

/**
 * The one heading assembled from a template that opens with an interpolation
 * (`listings.results.heading`, rendered by components/ResultsHeader.js). Its
 * first word is whichever plural property label the filters produced, or the
 * fallback subject — so those are the strings that decide whether that <h1>
 * starts with a capital.
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
