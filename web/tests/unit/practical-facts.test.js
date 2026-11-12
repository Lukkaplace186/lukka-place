import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as listings from '@/lib/listings';
import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  POWER_SUPPLY, WATER_SUPPLY, RAINY_ACCESS, PRACTICAL_COLUMNS,
  practicalFactsOf, hasPracticalFacts, practicalRows, answeredDateLabel,
} from '@/lib/practicalFacts';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test.beforeEach(() => reset());

// The engine module is read as text: requiring it would open the SQLite file.
function engineList(name) {
  const src = read('../services/practicalFacts.js');
  const body = src.match(new RegExp(`const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]\\)`))[1];
  return body.match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
}

function checkList(sql, column) {
  const body = sql.match(new RegExp(`${column} IN \\(([^)]*)\\)`))[1];
  return body.match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
}

test('the answer lists are the same in web, the engine and the migration CHECKs', () => {
  const sql = read('../migrations/20261112_listing_practical_facts.sql');
  for (const [name, list, column] of [
    ['POWER_SUPPLY', POWER_SUPPLY, 'power_supply'],
    ['WATER_SUPPLY', WATER_SUPPLY, 'water_supply'],
    ['RAINY_ACCESS', RAINY_ACCESS, 'rainy_access'],
  ]) {
    assert.deepEqual(engineList(name), [...list], `${name} engine`);
    assert.deepEqual(checkList(sql, column), [...list], `${name} CHECK`);
  }
  for (const column of PRACTICAL_COLUMNS) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} `), column);
  }
});

test('every answer the engine can store has a label in both languages', () => {
  for (const dict of [fr, en]) {
    const p = dict.listings.practical;
    for (const v of POWER_SUPPLY) assert.ok(p.powerValues[v], v);
    for (const v of WATER_SUPPLY) assert.ok(p.waterValues[v], v);
    for (const v of RAINY_ACCESS) assert.ok(p.accessValues[v], v);
    assert.ok(p.feeValues.oui && p.feeValues.non && p.notStated && p.title);
    assert.match(p.sourceDated, /\{date\}/);
  }
});

test('nothing answered is nothing shown; an unknown value is dropped, never guessed', () => {
  assert.equal(hasPracticalFacts(practicalFactsOf(null)), false);
  assert.equal(hasPracticalFacts(practicalFactsOf({ power_supply: 'groupe', visit_fee: null })), false);
  const facts = practicalFactsOf({ power_supply: 'snel_groupe', water_supply: null, rainy_access: 'inonde', visit_fee: false });
  assert.equal(hasPracticalFacts(facts), true);
  const rows = practicalRows(facts);
  assert.deepEqual(rows.map((r) => r.id), ['power', 'water', 'access', 'fee']);
  assert.equal(rows[0].valueKey, 'listings.practical.powerValues.snel_groupe');
  assert.equal(rows[1].valueKey, null, 'unanswered water reads "Non indiqué"');
  assert.equal(rows[2].tone, 'warning', 'a flooded road is flagged');
  assert.equal(rows[3].valueKey, 'listings.practical.feeValues.non');
  assert.equal(rows[3].tone, null);
  assert.equal(practicalRows(practicalFactsOf({ visit_fee: true }))[3].tone, 'warning', 'a paid visit is flagged');
  assert.equal(hasPracticalFacts(practicalFactsOf({ visit_fee: false })), true, 'a free visit is an answer');
});

test('the answer date is on the Kinshasa calendar', () => {
  assert.equal(answeredDateLabel('2026-11-12T23:30:00Z', 'fr'), '13 novembre 2026');
  assert.equal(answeredDateLabel(null), null);
});

test('the public listing row reads the fiche through to_jsonb, so it cannot 42703 before the migration', async () => {
  enqueue([]);
  await listings.getListingById(874);
  const { sql } = calls[0];
  assert.match(sql, /'power_supply', j -> 'power_supply'/);
  assert.match(sql, /'visit_fee', j -> 'visit_fee'/);
  assert.match(sql, /AS practical_facts/);
  assert.ok(!/p\.power_supply/.test(sql));
});

test('the listing page draws the card', () => {
  const page = read('app/(site)/listings/[id]/page.js');
  assert.match(page, /<PracticalFacts listing=\{listing\} \/>/);
});
