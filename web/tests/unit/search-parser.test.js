import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchQuery } from '@/lib/searchParser';
import { findLocationMention, searchGazetteer } from '@/lib/gazetteer';
import { keywordTokens, cleanKeywords } from '@/lib/searchKeywords';

/**
 * lib/searchParser.js against the way people in Kinshasa actually type.
 * Every row here was a real miss before the 2026-09-23 search pass — a
 * phrase that parsed to nothing, to the wrong place, or left words behind
 * that emptied the results page. `keywords: ''` is asserted wherever the
 * parser should have understood everything: a leftover word is exactly what
 * used to sink the search.
 */
function parsed(text) {
  const { spans: _spans, ...rest } = parseSearchQuery(text);
  return rest;
}

const CASES = [
  // Prices with no "sous"/"max"
  ['appart 2ch gombe 500$', { beds_min: 2, price_max: 500, property_type: 'appartement', commune: 'Gombe', keywords: '' }],
  ['2 chambres limete 1000 dollars', { beds_min: 2, price_max: 1000, commune: 'Limete', keywords: '' }],
  ['800 usd', { price_max: 800, keywords: '' }],
  ['maison 1500usd kinshasa', { price_max: 1500, property_type: 'maison', keywords: '' }],
  ['budget 800', { price_max: 800, keywords: '' }],
  ['1k max', { price_max: 1000, keywords: '' }],
  ['villa 150k', { price_max: 150000, property_type: 'parcelle', parcelle_subtype: 'villa', keywords: '' }],
  ['maison lemba 400', { price_max: 400, property_type: 'maison', commune: 'Lemba', keywords: '' }],
  ['2 chambres 1 500$', { beds_min: 2, price_max: 1500, keywords: '' }],
  // "under 1.5k" was read as a $1.50 ceiling plus a stray "k" keyword
  ['2 bedroom flat gombe under 1.5k', { beds_min: 2, price_max: 1500, property_type: 'appartement', commune: 'Gombe', keywords: '' }],
  // Ranges
  ['entre 500 et 1000$', { price_min: 500, price_max: 1000, keywords: '' }],
  ['500-800$', { price_min: 500, price_max: 800, keywords: '' }],
  ['500-800', { price_min: 500, price_max: 800, keywords: '' }],
  ['de 300 à 600 $', { price_min: 300, price_max: 600, keywords: '' }],
  // Rooms
  ['deux chambres a gombe', { beds_min: 2, commune: 'Gombe', keywords: '' }],
  ['apt 3 pieces ngaliema', { beds_min: 2, property_type: 'appartement', commune: 'Ngaliema', keywords: '' }],
  ['3ch 2sdb', { beds_min: 3, bath_min: 2, keywords: '' }],
  ['basuku mibale na lemba', { beds_min: 2, commune: 'Lemba', keywords: '' }],
  // "chambre salon" used to resolve to the quartier Salongo
  ['chambre salon', { beds_min: 1, keywords: '' }],
  ['chambre salon bandal', { beds_min: 1, commune: 'Bandalungwa', keywords: '' }],
  // Types, abbreviations, typos
  ['appartemnt a lingwala', { property_type: 'appartement', commune: 'Lingwala', keywords: '' }],
  ['petit appart pas cher', { property_type: 'appartement', keywords: '' }],
  ['maison a louer lemba pas cher', { transaction_type: 'location', property_type: 'maison', commune: 'Lemba', keywords: '' }],
  // Places
  ['a louer cite verte', { transaction_type: 'location', commune: 'Mont-Ngafula', quartier: 'Cité-Verte', keywords: '' }],
  ['mont fleury', { commune: 'Ngaliema', quartier: 'Mont-Fleury', keywords: '' }],
  ['binza', { commune: 'Ngaliema', keywords: '' }],
  ['kin centre', { commune: 'Gombe', keywords: '' }],
  ['appartement centre-ville 1000$', { price_max: 1000, property_type: 'appartement', commune: 'Gombe', keywords: '' }],
  ['commune de kinshasa', { commune: 'Kinshasa', keywords: '' }],
  // Several places, all searched, in the order typed
  ['appartement gombe ou ngaliema', { property_type: 'appartement', commune: 'Gombe', communes: ['Gombe', 'Ngaliema'], keywords: '' }],
  ['Gombe, Ngaliema, Limete', { commune: 'Gombe', communes: ['Gombe', 'Ngaliema', 'Limete'], keywords: '' }],
  // A quartier name shared by three communes searches all three
  ['salongo', { commune: 'Kasa-Vubu', quartier: 'Salongo', communes: ['Kasa-Vubu', 'Limete', 'Lemba'], keywords: '' }],
  // Real requests stay as words
  ['studio meublé kintambo', { property_type: 'appartement', commune: 'Kintambo', keywords: 'meublé' }],
  ['villa avec piscine ma campagne', { property_type: 'parcelle', parcelle_subtype: 'villa', commune: 'Ngaliema', quartier: 'Ma Campagne', keywords: 'piscine' }],
  // A landmark is a place to search around (`near`), never leftover words:
  // as keywords it filtered the map and the list down to nothing.
  ['house near UPN', { property_type: 'maison', commune: 'Ngaliema', near: 'UPN', keywords: '' }],
  ['appartement près de saint luc', { property_type: 'appartement', commune: 'Ngaliema', near: 'St Luc', keywords: '' }],
  ['LKP-2026-0091', { reference: 'LKP-2026-0091', keywords: '' }],
];

for (const [text, expected] of CASES) {
  test(`parses ${JSON.stringify(text)}`, () => {
    assert.deepEqual(parsed(text), expected);
  });
}

test('a dimension or a street number is never read as a price', () => {
  assert.equal(parsed('terrain 15x20 nsele').price_max, undefined);
  assert.equal(parsed('appartement avenue 24 gombe').price_max, undefined);
});

test('a non-string never reaches the search as "[object Object]"', () => {
  assert.equal(parsed({ target: 1 }).keywords, '');
});

test('everyday words are never guessed into place names', () => {
  // Each was a real misfire of the fuzzy tier.
  assert.equal(findLocationMention('chambre salon'), null);
  assert.equal(findLocationMention('petit appart'), null);
  assert.equal(findLocationMention('une cité'), null);
  // An exact name still works.
  assert.equal(findLocationMention('Salongo')?.label, 'Salongo');
});

test('an ambiguous prefix inside one commune resolves to that commune', () => {
  const binza = findLocationMention('binza');
  assert.equal(binza.type, 'commune');
  assert.equal(binza.commune, 'Ngaliema');
});

test('matchedText is the visitor’s own text, so the parser can strip it', () => {
  const mention = findLocationMention('à louer cite verte svp');
  assert.equal(mention.label, 'Cité-Verte');
  assert.equal(mention.matchedText, 'cite verte');
});

test('the autocomplete forgives how a place is written: St/Saint, RP/Rond-Point, a cut-off word', () => {
  for (const q of ['St lu', 'Saint Luc', 'saint luc', 'st luc']) {
    assert.equal(searchGazetteer(q)[0]?.label, 'St Luc', q);
  }
  assert.equal(searchGazetteer('RP Victoire')[0]?.label, 'Rond-Point Victoire');
  // An alias never changes the label the search answers with.
  assert.equal(findLocationMention('près de saint luc')?.label, 'St Luc');
});

test('the autocomplete finds hyphenated names typed with spaces', () => {
  assert.ok(searchGazetteer('cite verte').some((r) => r.label === 'Cité-Verte'));
  assert.ok(searchGazetteer('mont fleury').some((r) => r.label === 'Mont-Fleury'));
});

test('keywordTokens drops filler and keeps real requests, accent-folded', () => {
  assert.deepEqual(keywordTokens('pas cher avec piscine près de l’UPN svp'), ['piscine', 'upn']);
  assert.deepEqual(keywordTokens('Meublé, climatisé'), ['meuble', 'climatise']);
  assert.deepEqual(keywordTokens('500 $ kinshasa'), []);
  assert.equal(cleanKeywords('très joli meublé'), 'meublé');
});
