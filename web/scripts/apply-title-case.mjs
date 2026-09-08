/**
 * Rewrites every English heading string in lib/i18n/en.json to Title Case.
 *
 * Committed rather than run once and forgotten, for two reasons: the diff it
 * produces is reviewable against a rule anyone can re-run, and a heading
 * added later can be brought in line with `node scripts/apply-title-case.mjs`
 * instead of by hand. `--check` reports without writing.
 *
 * **English only, deliberately.** fr.json is never touched: French headings
 * take sentence case ("Créer un compte agent"), and "Créer Un Compte Agent"
 * reads to a French speaker the way "create an agent account" reads to an
 * English one. See lib/titleCase.js.
 *
 * The rule and the key detection both live elsewhere and are shared with
 * tests/unit/heading-capitalization.test.js, so the transform and the test
 * that guards it cannot drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allHeadingKeys, lookup, setIn } from './heading-keys.mjs';
import { toTitleCase } from '../lib/titleCase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN = path.join(ROOT, 'lib/i18n/en.json');
const check = process.argv.includes('--check');

const dict = JSON.parse(readFileSync(EN, 'utf8'));
const changes = [];

for (const key of allHeadingKeys(dict, ROOT)) {
  const value = lookup(dict, key);
  if (typeof value !== 'string') continue;
  const titled = toTitleCase(value);
  if (titled === value) continue;
  changes.push({ key, from: value, to: titled });
  if (!check) setIn(dict, key, titled);
}

for (const { key, from, to } of changes) console.log(`${key}\n  - ${from}\n  + ${to}`);

if (check) {
  console.log(`\n${changes.length} heading(s) not in Title Case.`);
  process.exit(changes.length === 0 ? 0 : 1);
}

// Two-space indent + trailing newline — the shape the file already has, so
// the diff is the strings and nothing else.
writeFileSync(EN, `${JSON.stringify(dict, null, 2)}\n`, 'utf8');
console.log(`\n${changes.length} heading(s) rewritten to Title Case in lib/i18n/en.json.`);
