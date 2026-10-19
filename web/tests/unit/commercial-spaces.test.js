import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import * as listings from '@/lib/listings';
import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  COMMERCIAL_FILTER_VALUE,
  COMMERCIAL_SPEC_FIELDS,
  FLOOR_MAX,
  FLOOR_MIN,
  OFFICE_COUNT_MAX,
  commercialFacts,
  commercialSpecsFromForm,
  commercialSpecsOf,
  facetLabel,
  floorLabel,
  groupTypeFacets,
  isCommercial,
} from '@/lib/commercialSpaces';
import { specItems } from '@/lib/listingView';
import { parseSeoSegments, seoPath, landingPathsFromFacets, OVERLAY_PROPERTY_TYPES } from '@/lib/seoPages';
import { buildFormValuesFromParsed, matchCategoryId } from '@/lib/smartPaste';
import { PROPERTY_TYPE_PLURAL_KEYS } from '@/lib/constants';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test.beforeEach(() => reset());

test('the specs and their bounds are the same in web, the engine and the migration CHECKs', () => {
  const engine = require('../../../services/commercial.js');
  assert.deepEqual([...engine.COMMERCIAL_SPEC_FIELDS], [...COMMERCIAL_SPEC_FIELDS]);
  assert.equal(engine.OFFICE_COUNT_MAX, OFFICE_COUNT_MAX);
  assert.equal(engine.FLOOR_MIN, FLOOR_MIN);
  assert.equal(engine.FLOOR_MAX, FLOOR_MAX);
  const sql = read('../migrations/20261019_commercial_spaces.sql');
  assert.ok(sql.includes(`office_count BETWEEN 0 AND ${OFFICE_COUNT_MAX}`));
  assert.ok(sql.includes(`floor_level BETWEEN ${FLOOR_MIN} AND ${FLOOR_MAX}`));
});

test('commercial is the category type, never a list of names', () => {
  assert.equal(isCommercial({ type: 'commercial' }), true);
  assert.equal(isCommercial({ category_type: 'Commercial' }), true);
  assert.equal(isCommercial({ type: 'residential' }), false);
  assert.equal(isCommercial({ category_name: 'Bureau' }), false, 'a name alone decides nothing');
  assert.equal(isCommercial(undefined), false);
});

test('a checkbox only ever says yes: unticked is "not stated", never a recorded no', () => {
  const form = new FormData();
  form.set('office_count', '4');
  form.set('floor_level', '0');
  form.set('road_frontage', '1');
  assert.deepEqual(commercialSpecsFromForm(form), { office_count: 4, floor_level: 0, road_frontage: true, truck_access: null });
  const bad = new FormData();
  bad.set('office_count', '-2');
  bad.set('floor_level', '99');
  assert.deepEqual(commercialSpecsFromForm(bad), { office_count: null, floor_level: null, road_frontage: null, truck_access: null });
});

test('a listing row carries the specs as one jsonb read through to_jsonb, and its category type', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({});
  const { sql } = calls.find((c) => /SELECT\s+p\.id/.test(c.sql));
  assert.match(sql, /FROM \(SELECT to_jsonb\(p\) AS j\) spec\) AS commercial_specs/);
  assert.match(sql, /cat\.type AS category_type/);
  assert.equal(commercialSpecsOf({ commercial_specs: { office_count: 3, floor_level: null, road_frontage: true, truck_access: null } }).office_count, 3);
});

test('property_type=commercial filters on the category type and keeps the public gate', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({ propertyType: COMMERCIAL_FILTER_VALUE });
  const { sql } = calls[0];
  assert.match(sql, /LOWER\(cat\.type\) = 'commercial'/);
  assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
});

test('the "Locaux commerciaux" facet appears only when it says more than one type does', async () => {
  enqueue([
    { label: 'Appartement', category_type: 'residential', n: '9' },
    { label: 'Bureau', category_type: 'commercial', n: '2' },
    { label: 'Boutique', category_type: 'commercial', n: '3' },
  ]);
  enqueue([{ n: '0' }]);
  const facets = await listings.getPropertyTypeFacets();
  const umbrella = facets.find((f) => f.value === COMMERCIAL_FILTER_VALUE);
  assert.equal(umbrella.count, 5);
  assert.equal(umbrella.labelKey, 'listings.typePlurals.commercial');
  const { residential, commercial } = groupTypeFacets(facets);
  assert.deepEqual(residential.map((f) => f.value), ['appartement']);
  assert.equal(commercial[0].value, COMMERCIAL_FILTER_VALUE, 'the umbrella leads its group');

  reset();
  enqueue([
    { label: 'Appartement', category_type: 'residential', n: '9' },
    { label: 'Boutique', category_type: 'commercial', n: '3' },
  ]);
  enqueue([{ n: '0' }]);
  const single = await listings.getPropertyTypeFacets();
  assert.ok(!single.some((f) => f.value === COMMERCIAL_FILTER_VALUE), 'no "Boutique (3)" beside "Locaux commerciaux (3)"');
  assert.equal(facetLabel(umbrella, (k) => fr.listings.typePlurals.commercial), 'Locaux commerciaux');
});

test('landing pages: /location/bureaux and /location/locaux-commerciaux, never counted twice', () => {
  assert.equal(parseSeoSegments('location', ['bureaux']).propertyType, 'bureau');
  assert.equal(parseSeoSegments('vente', ['locaux-commerciaux', 'gombe']).propertyType, COMMERCIAL_FILTER_VALUE);
  assert.equal(seoPath({ transaction: 'location', propertyType: COMMERCIAL_FILTER_VALUE, commune: 'Gombe' }), '/location/locaux-commerciaux/gombe');
  assert.ok(OVERLAY_PROPERTY_TYPES.has(COMMERCIAL_FILTER_VALUE));
  const paths = landingPathsFromFacets([{ commune: 'Gombe', purpose: 'rent', propertyType: COMMERCIAL_FILTER_VALUE, count: 2 }]);
  assert.ok(paths.includes('/location/locaux-commerciaux/gombe'));
  for (const value of ['bureau', COMMERCIAL_FILTER_VALUE, 'entrepôt', 'bâtiment']) {
    assert.ok(PROPERTY_TYPE_PLURAL_KEYS[value], `results heading for ${value}`);
  }
});

test('the card leads with offices; the listing page states only what the agent said', () => {
  const office = {
    category_type: 'commercial', category_name: 'Bureau', area: '180', beds: null, bath: 2,
    commercial_specs: { office_count: 6, floor_level: 0, road_frontage: true, truck_access: null },
  };
  assert.deepEqual(specItems(office).map((i) => i.key), ['bath', 'area', 'offices']);
  const facts = commercialFacts(office);
  assert.deepEqual(facts.map((f) => f.key), ['offices', 'floor', 'frontage']);
  assert.equal(facts[1].value, 'Rez-de-chaussée');
  const home = { category_type: 'residential', beds: 3, commercial_specs: { office_count: 6 } };
  assert.ok(!specItems(home).some((i) => i.key === 'offices'), 'a home never shows an office count');
  assert.equal(floorLabel(-1), 'Sous-sol');
  assert.equal(floorLabel(3, (k, v) => (k.endsWith('nth') ? `${v.n}e étage` : k)), '3e étage');
});

test('smart paste maps a pasted office onto the Bureau category and its specs', () => {
  const categories = [
    { id: 34, name: 'Appartement', type: 'residential' },
    { id: 38, name: 'Bâtiment', type: 'commercial' },
    { id: 44, name: 'Bureau', type: 'commercial' },
  ];
  assert.equal(matchCategoryId(categories, 'bureau'), 44);
  assert.equal(matchCategoryId(categories, 'immeuble'), 38, '"immeuble" is the Bâtiment category');
  const mapped = buildFormValuesFromParsed(
    { property_type: 'bureau', office_count: 4, floor_level: 1, road_frontage: true, truck_access: null },
    { communes: [], categories, rawText: '' },
  );
  assert.equal(mapped.categoryId, 44);
  assert.equal(mapped.officeCount, '4');
  assert.equal(mapped.floorLevel, 1);
  assert.equal(mapped.roadFrontage, true);
  assert.equal(mapped.truckAccess, false);
});

test('the agent forms swap bedrooms for the commercial specs, and the server re-checks the category', () => {
  const dialog = read('components/CreateListingDialog.js');
  assert.match(dialog, /<CommercialSpecFields hidden=\{!commercialCategory\}/);
  assert.match(dialog, /optgroup label=\{t\('listings\.commercial\.group\.commercial'\)\}/);
  const editor = read('components/AgentListingEditor.js');
  assert.match(editor, /if \(commercial\) formData\.set\('commercial_touched', '1'\)/);
  const actions = read('app/compte/agent/actions.js');
  assert.match(actions, /beds: commercial \? null : beds/);
  const repo = read('lib/agentListings.js');
  assert.match(repo, /WHERE id = \$5 AND agent_id = \$6\s+AND EXISTS \(SELECT 1 FROM property_categories c WHERE c\.id = properties\.category_id AND LOWER\(c\.type\) = 'commercial'\)/);
  assert.match(repo, /if \(err\?\.code === '42703'\) return 'unavailable';/);
});

test('every new label exists in both languages with the same placeholders', () => {
  const walk = (node, prefix = '') => Object.entries(node).flatMap(([k, v]) =>
    (typeof v === 'object' ? walk(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  const frKeys = Object.fromEntries(walk(fr.listings.commercial));
  const enKeys = Object.fromEntries(walk(en.listings.commercial));
  assert.deepEqual(Object.keys(frKeys).sort(), Object.keys(enKeys).sort());
  assert.match(frKeys['floor.nth'], /\{n\}/);
  assert.match(enKeys['floor.nth'], /\{n\}/);
  for (const key of ['bureau', 'commercial']) {
    assert.ok(fr.listings.typePlurals[key] && en.listings.typePlurals[key], key);
  }
  assert.ok(fr.listings.specs.offices && en.listings.specs.offices);
});
