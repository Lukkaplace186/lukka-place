import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatureLines, listingFeatures } from '@/lib/descriptionParser';

/**
 * The "Caractéristiques principales" list
 * (components/listings/PropertyDescription.js).
 *
 * The hazard this guards is the opposite of the amenity-chip one: chips can
 * claim a feature the listing never stated, while this section can look
 * populated while saying nothing. Every Kinshasa description on the live
 * site today is one flowing sentence written for a reader — 0 of the 48
 * currently approved rows contain a newline, checked directly against
 * production — so a naive "split the description on full stops" fallback
 * produces bullets that restate, one line up, the paragraph immediately
 * below them. Several checks here exist specifically to keep that from
 * shipping.
 *
 * `t` is a real translator stand-in returning the key, so the precedence
 * assertions below don't depend on dictionary wording.
 */
const t = (key) => key;

test('a real multi-line WhatsApp-style description becomes one bullet per line', () => {
  const lines = parseFeatureLines(
    'Appartement 3 chambres\n- Climatisation dans toutes les pièces\n- Parking privé\n• Eau et électricité 24h/24',
  );
  assert.deepEqual(lines, [
    'Appartement 3 chambres',
    'Climatisation dans toutes les pièces',
    'Parking privé',
    'Eau et électricité 24h/24',
  ]);
});

test('numbered list markers are stripped, not kept as part of the feature', () => {
  assert.deepEqual(parseFeatureLines('1. Salon spacieux\n2) Cuisine équipée'), [
    'Salon spacieux',
    'Cuisine équipée',
  ]);
});

test('a single sentence is split on sentence boundaries only when the pieces read as features', () => {
  assert.deepEqual(parseFeatureLines('Salon spacieux. Cuisine équipée. Parking privé.'), [
    'Salon spacieux',
    'Cuisine équipée',
    'Parking privé',
  ]);
});

/**
 * A REAL production description (property #300). It is prose: splitting it
 * yields two sentences that are each a paragraph, and bulleting them would
 * put the description above the description.
 */
test('a real prose description yields no bullets at all', () => {
  const real = "Cet appartement situé au premier niveau dans la commune de Bandalungwa est "
    + "disponible à la location. Il comprend deux chambres, un salon, une cuisine et une "
    + "salle de bain. L'appartement bénéficie d'un bon approvisionnement en eau et en électricité.";
  assert.deepEqual(parseFeatureLines(real), []);
});

test('one usable fragment is discarded — a single bullet is not a list', () => {
  assert.deepEqual(parseFeatureLines('Parking privé'), []);
});

test('an abbreviation\'s full stop does not end a sentence', () => {
  // Without the guard this splits into "Réf" / "LKP-2026-0091, parking privé".
  assert.deepEqual(parseFeatureLines('Réf. LKP-2026-0091. Parking privé. Jardin clôturé.'), [
    'Réf. LKP-2026-0091',
    'Parking privé',
    'Jardin clôturé',
  ]);
});

test('repeated lines collapse, case-insensitively', () => {
  assert.deepEqual(parseFeatureLines('Parking privé\nPARKING PRIVÉ\nJardin clôturé'), [
    'Parking privé',
    'Jardin clôturé',
  ]);
});

test('nothing at all is a real answer, not a throw', () => {
  assert.deepEqual(parseFeatureLines(null), []);
  assert.deepEqual(parseFeatureLines(''), []);
  assert.deepEqual(parseFeatureLines(undefined), []);
});

// ---------------------------------------------------------------------------
// listingFeatures — which source wins, and what the caller is told about it
// ---------------------------------------------------------------------------

test('a real features column wins outright and is rendered verbatim', () => {
  const { items, source } = listingFeatures(
    {
      features: ['Eau et électricité 24h/24', 'Vue sur le fleuve'],
      // Both of the weaker sources are available and must not be consulted.
      description: 'Appartement climatisé avec parking. Jardin clôturé.',
    },
    t,
  );
  assert.equal(source, 'column');
  assert.deepEqual(items.map((i) => i.label), ['Eau et électricité 24h/24', 'Vue sur le fleuve']);
});

test('an empty or non-array features column falls through rather than suppressing the list', () => {
  const listing = { features: [], description: 'Appartement climatisé avec parking privé.' };
  assert.equal(listingFeatures(listing, t).source, 'amenities');
  assert.equal(listingFeatures({ ...listing, features: null }, t).source, 'amenities');
  assert.equal(listingFeatures({ ...listing, features: undefined }, t).source, 'amenities');
});

test('with no column, real keyword matches against the listing\'s own text are used', () => {
  const { items, source } = listingFeatures(
    { description: 'Appartement climatisé, avec parking et gardien, forage sur la parcelle.' },
    t,
  );
  assert.equal(source, 'amenities');
  const keys = items.map((i) => i.amenityKey);
  assert.ok(keys.includes('ac'), `expected ac in ${keys}`);
  assert.ok(keys.includes('parking'), `expected parking in ${keys}`);
  assert.ok(keys.includes('security'), `expected security in ${keys}`);
  assert.ok(keys.includes('borehole'), `expected borehole in ${keys}`);
});

/**
 * The detail page used to pass max=5 into matchedAmenityKeys, out of a
 * ten-key vocabulary — so a listing that stated six real features showed
 * five and silently dropped one. There is room for all of them here.
 */
test('the keyword pass is not capped below the real vocabulary', () => {
  const { items } = listingFeatures(
    {
      description: 'Groupe électrogène, panneaux solaires, forage, ligne dédiée, route asphaltée, '
        + 'gardien, parking, climatisation, meublé.',
    },
    t,
  );
  assert.ok(items.length >= 8, `only ${items.length} features survived`);
});

test('a listing with neither a column nor a keyword falls back to its own description lines', () => {
  const { items, source } = listingFeatures(
    { description: 'Salon spacieux\nCuisine équipée\nGrande terrasse' },
    t,
  );
  assert.equal(source, 'description');
  assert.deepEqual(items.map((i) => i.label), ['Salon spacieux', 'Cuisine équipée', 'Grande terrasse']);
});

test('a listing with genuinely nothing to say renders no list and says so', () => {
  const { items, source } = listingFeatures(
    { description: 'Ce terrain nu est disponible à la vente dans le quartier Righini à Lemba.' },
    t,
  );
  assert.deepEqual(items, []);
  assert.equal(source, null);
});

test('a missing listing is not a crash', () => {
  assert.deepEqual(listingFeatures(null, t), { items: [], source: null });
});

test('every item carries a stable, unique key for React', () => {
  const { items } = listingFeatures(
    { features: ['Parking privé', 'Jardin clôturé', 'Cuisine équipée'] },
    t,
  );
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});
