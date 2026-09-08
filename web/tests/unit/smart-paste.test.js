import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchCommune,
  matchCategoryId,
  matchAmenityIds,
  cleanDescription,
  buildFormValuesFromParsed,
} from '@/lib/smartPaste';

/**
 * Smart Paste (root CLAUDE.md) maps the engine's raw extraction onto real
 * form values — a real commune from the allow-list, a real category id, a
 * real amenity id. Every test here is really pinning "never fabricate a
 * value the option lists don't actually offer".
 */

test('matchCommune only ever returns a value from the real list', () => {
  const communes = ['Gombe', 'Ngaliema', 'Kasa-Vubu'];
  assert.equal(matchCommune(communes, 'Gombe'), 'Gombe');
  // Accent/case drift still resolves to the real spelling.
  assert.equal(matchCommune(communes, 'gombé'), 'Gombe');
  // Never invents a commune the list doesn't have.
  assert.equal(matchCommune(communes, 'Kinshasa'), null);
  assert.equal(matchCommune(communes, null), null);
});

test('matchCategoryId prefers the parcelle_subtype signal over property_type', () => {
  const categories = [
    { id: 1, name: 'Appartement' },
    { id: 2, name: 'Maison' },
    { id: 3, name: 'Villa' },
    { id: 4, name: 'Terrain' },
  ];
  // A parcelle classified as villa must land on the real "Villa" category,
  // not "Maison" — parcelle_subtype is more specific than property_type.
  assert.equal(matchCategoryId(categories, 'parcelle', 'villa'), 3);
  assert.equal(matchCategoryId(categories, 'parcelle', 'maison_type_locataire'), 2);
  assert.equal(matchCategoryId(categories, 'appartement', null), 1);
  // Nothing invented when the option list has no plausible match.
  assert.equal(matchCategoryId(categories, 'bureau', null), null);
  assert.equal(matchCategoryId([], 'appartement', null), null);
});

test('matchAmenityIds only returns ids for amenities the agency actually has, matched against real text', () => {
  const amenities = [
    { id: 45, name: 'Climatisation' },
    { id: 46, name: 'Parking' },
    { id: 47, name: 'Groupe électrogène' },
  ];
  const ids = matchAmenityIds(amenities, 'Appartement climatisé avec parking, courant stable');
  assert.deepEqual(new Set(ids), new Set([45, 46]));

  // A keyword hit with no corresponding real amenity row contributes nothing.
  assert.deepEqual(matchAmenityIds([{ id: 1, name: 'Piscine' }], 'Climatisé et meublé'), []);
  assert.deepEqual(matchAmenityIds(amenities, 'Rien de spécial ici'), []);
});

test('cleanDescription strips WhatsApp-style leftovers a raw pasted description might carry', () => {
  assert.equal(cleanDescription('*Bel appartement* 🏡 avec vue.'), 'Bel appartement avec vue.');
  assert.equal(cleanDescription('  Texte   avec   espaces  '), 'Texte avec espaces');
  assert.equal(cleanDescription(null), '');
});

test('buildFormValuesFromParsed never sets a field the extraction did not actually provide', () => {
  const communes = ['Gombe'];
  const categories = [{ id: 1, name: 'Appartement' }];
  const amenities = [{ id: 45, name: 'Climatisation' }];

  const mapped = buildFormValuesFromParsed(
    {
      title_suggestion: 'Appartement 3 chambres à louer à Gombe',
      transaction_type: 'location',
      property_type: 'appartement',
      parcelle_subtype: null,
      commune: 'Gombe',
      quartier: 'Cabinda',
      reference: null,
      price: 750,
      currency: 'USD',
      price_period: 'mois',
      deposit_months: 3,
      advance_months: 1,
      commission_months: 1,
      bedrooms: 3,
      bathrooms: 3,
      surface_area_sqm: null,
      units_count: null,
      furnished: null,
      description_fr: 'Appartement climatisé avec parking.',
      confidence: 0.9,
    },
    { communes, categories, amenities, rawText: 'Appartement climatisé avec parking.' },
  );

  assert.equal(mapped.title, 'Appartement 3 chambres à louer à Gombe');
  assert.equal(mapped.purpose, 'rent');
  assert.equal(mapped.categoryId, 1);
  assert.equal(mapped.commune, 'Gombe');
  assert.equal(mapped.quartier, 'Cabinda');
  assert.equal(mapped.price, '750');
  assert.equal(mapped.currency, 'USD');
  assert.equal(mapped.beds, '3');
  assert.equal(mapped.bath, '3');
  // Never invents a deposit split into commission/advance — deposit_months
  // is exposed on its own, matching the "3 + 1 + 1" fields the properties
  // table (and this form) actually carries (root CLAUDE.md).
  assert.equal(mapped.depositMonths, '3');
  assert.deepEqual(mapped.amenityIds, [45]);
  assert.equal(mapped.description, 'Appartement climatisé avec parking.');

  // Fields the model didn't extract stay empty/null, never a fabricated 0
  // or a guessed default.
  assert.equal(mapped.area, '');
  assert.equal(mapped.unitsCount, '');
});

test('buildFormValuesFromParsed leaves currency untouched when no price was extracted', () => {
  const mapped = buildFormValuesFromParsed(
    {
      title_suggestion: null,
      transaction_type: null,
      property_type: null,
      parcelle_subtype: null,
      commune: null,
      quartier: null,
      reference: null,
      price: null,
      currency: null,
      price_period: null,
      deposit_months: null,
      advance_months: null,
      commission_months: null,
      bedrooms: null,
      bathrooms: null,
      surface_area_sqm: null,
      units_count: null,
      furnished: null,
      description_fr: '',
      confidence: 0.1,
    },
    { communes: [], rawText: '' },
  );
  assert.equal(mapped.price, '');
  assert.equal(mapped.currency, null);
});
