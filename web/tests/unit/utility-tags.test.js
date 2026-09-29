import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import * as listings from '@/lib/listings';
import { calls, enqueue, reset } from '../support/fakePool.js';
import { UTILITY_CODES, UTILITY_FILTERS, UTILITY_FILTER_KEYS, normaliseUtilities, utilityGroupOf } from '@/lib/utilityTags';
import { searchCriteriaTags } from '@/lib/searchLabel';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test.beforeEach(() => reset());

test('the codes are the same in web, the engine and the migration CHECK', () => {
  const engine = require('../../../services/utilities.js');
  assert.deepEqual([...engine.UTILITY_CODES], [...UTILITY_CODES]);
  const sql = read('../migrations/20260929_listing_utilities.sql');
  const inCheck = sql.match(/ARRAY\[([^\]]*)\]::text\[\]/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(inCheck, [...UTILITY_CODES]);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS utilities text\[\]/);
});

test('every code belongs to exactly one of the four chips', () => {
  assert.deepEqual(UTILITY_FILTER_KEYS, ['electricite', 'eau', 'securite', 'acces']);
  const all = UTILITY_FILTER_KEYS.flatMap((key) => UTILITY_FILTERS[key].codes);
  assert.deepEqual([...all].sort(), [...UTILITY_CODES].sort());
  assert.equal(utilityGroupOf('forage'), 'eau');
  assert.deepEqual(normaliseUtilities(['FORAGE', 'piscine', 'snel_stable', 'forage']), ['snel_stable', 'forage']);
});

test('a chip matches the structured codes OR the listing text — never only one of them', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({ amenities: ['eau'] });
  const { sql, values } = calls[0];
  assert.match(sql, /COALESCE\(to_jsonb\(p\) -> 'utilities', '\[\]'::jsonb\) \?\| \$\d+::text\[\] OR pc\.title ~\* \$\d+/);
  assert.ok(values.some((v) => Array.isArray(v) && v.join() === 'regideso,citerne,forage'));
  assert.ok(values.includes('\\yregideso'));
  // The words live in `features` far more often than in the description.
  assert.match(sql, /array_to_string\(COALESCE\(p\.features, '\{\}'::text\[\]\), ' '\) ~\* \$\d+/);
  assert.ok(!/p\.utilities/.test(sql), 'read through to_jsonb, so the query cannot 42703 before the migration');
});

test('the public listing row carries the codes through to_jsonb', async () => {
  enqueue([]);
  await listings.getListingById(310);
  assert.match(calls.map((c) => c.sql).join('\n'), /COALESCE\(to_jsonb\(p\) -> 'utilities', '\[\]'::jsonb\) AS utilities/);
});

test('saved-search labels name the chips', () => {
  const t = (key) => key.split('.').reduce((o, k) => o?.[k], fr) ?? key;
  const tags = searchCriteriaTags(new URLSearchParams('amenities=electricite,acces'), t);
  const text = Array.isArray(tags) ? tags.join(' ') : String(tags);
  assert.match(text, /Électricité/);
  assert.match(text, /Accès/);
});

test('every code and chip has a label in both languages', () => {
  for (const dict of [fr, en]) {
    for (const code of UTILITY_CODES) assert.ok(dict.listings.utilities[code], code);
    for (const key of UTILITY_FILTER_KEYS) assert.ok(dict.listings.utilityFilters[key], key);
  }
  assert.equal(fr.listings.utilities.declared, 'Déclaré par l’agent');
});

test('the listing page says "déclaré", never "vérifié"', () => {
  const badges = read('components/listings/UtilityBadges.js');
  assert.match(badges, /listings\.utilities\.declared/);
  assert.ok(!/verified|vérifi/i.test(badges.replace(/\/\*[\s\S]*?\*\//g, '')));
});

test("the editor sends codes only when touched, and the save can't fail the edit", () => {
  const editor = read('components/AgentListingEditor.js');
  assert.match(editor, /formData\.set\('utilities_touched', utilitiesTouched \? '1' : '0'\)/);
  const action = read('app/compte/agent/actions.js');
  assert.match(action, /formData\.get\('utilities_touched'\) === '1'/);
  assert.match(action, /normaliseUtilities\(formData\.getAll\('utilities'\)\)/);
  const lib = read('lib/agentListings.js');
  assert.match(lib, /WHERE id = \$2 AND agent_id = \$3/);
  assert.match(lib, /err\?\.code === '42703'\) return 'unavailable'/);
});
