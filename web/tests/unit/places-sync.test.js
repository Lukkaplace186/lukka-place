import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchGazetteer, findLocationMention } from '@/lib/gazetteer';

// The engine reads quartiers from kinshasa_locations.json + kinshasa_quartier_aliases.json
// (services/locations.js); the storefront's search reads lib/data/kinshasa-gazetteer.json.
// Until 2026-10-07 the two disagreed (Cité-Verte in Mont-Ngafula, no "GB", no "Mimosas",
// ~320 official quartiers missing from search). Reads engine-repo files, so it cannot run
// on the VPS web dir — same by-construction category as the write-path parity checks.

const engine = (rel) => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const gazetteer = JSON.parse(readFileSync(new URL('../../lib/data/kinshasa-gazetteer.json', import.meta.url), 'utf8'));
const CANON = { "N'Djili": 'Ndjili', "N'Sele": 'Nsele' };
const key = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-'’/.]+/g, ' ').replace(/\s+/g, ' ').trim();
// Commune-level names stay out of the quartier list: as quartiers they turned a
// search for the commune into a search for a quartier of the same name.
const COMMUNE_LEVEL = new Set(['binza', 'bandal']);

function namesIn(commune) {
  const entry = gazetteer.find((g) => g.commune === commune);
  assert.ok(entry, `gazetteer has ${commune}`);
  return new Set([...entry.quartiers, ...entry.landmarks].map(key));
}

test('every official quartier the engine knows is searchable in its own commune', () => {
  for (const [raw, quartiers] of Object.entries(engine('kinshasa_locations.json'))) {
    const names = namesIn(CANON[raw] || raw);
    for (const q of quartiers) assert.ok(names.has(key(q)), `${q} (${raw})`);
  }
});

test('every alias the engine deduces or asks about is searchable in each of its communes', () => {
  for (const alias of engine('kinshasa_quartier_aliases.json').aliases) {
    if (COMMUNE_LEVEL.has(key(alias.name))) continue;
    for (const c of alias.communes) assert.ok(namesIn(CANON[c] || c).has(key(alias.name)), `${alias.name} (${c})`);
  }
});

test('the places agents write find the right commune in search', () => {
  assert.equal(findLocationMention('appartement à GB 1000$')?.commune, 'Ngaliema');
  assert.equal(searchGazetteer('mimosas')[0]?.commune, 'Ngaliema');
  assert.equal(searchGazetteer('synkin')[0]?.commune, 'Bandalungwa');
  assert.ok(!gazetteer.find((g) => g.commune === 'Mont-Ngafula').quartiers.includes('Cité-Verte'));
});
