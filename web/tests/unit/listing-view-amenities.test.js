import test from 'node:test';
import assert from 'node:assert/strict';
import { matchedAmenities, matchedAmenityKeys, formatFreshness } from '@/lib/listingView';

/**
 * Feature chips are the card's highest-value content — in Kinshasa, power and
 * water routinely decide a listing — and they are also the easiest thing on
 * the card to make dishonest, because there is no structured amenity column
 * on `properties`. Every chip is a real word-boundary match against the
 * listing's own title/description text (lib/constants.js's AMENITY_KEYWORDS,
 * the same list the "Plus de filtres" checkboxes filter with server-side).
 *
 * The specific hazard pinned here: AMENITY_KEYWORDS.borehole matches BOTH
 * 'forage' (a drilled borehole) and 'citerne' (a water tank). Those are
 * different pieces of infrastructure. A card that badges a forage-only
 * listing as "Citerne" is claiming something the listing never said, so
 * `matchedAmenities` reports which keyword actually hit and the chip labels
 * from that.
 */
const listing = (description, title = '') => ({ title, description });

test('the chip label follows the keyword the listing actually used', () => {
  const forage = matchedAmenities(listing('Parcelle avec forage'), 3);
  assert.deepEqual(forage, [{ key: 'borehole', matched: 'forage' }]);

  const citerne = matchedAmenities(listing("Villa avec citerne d'eau"), 3);
  assert.deepEqual(citerne, [{ key: 'borehole', matched: 'citerne' }]);

  // Same key for both — the distinction lives entirely in `matched`, which is
  // why the label must not be derived from `key` alone.
  assert.equal(forage[0].key, citerne[0].key);
  assert.notEqual(forage[0].matched, citerne[0].matched);
});

test('a listing that never mentions an amenity gets no chip for it', () => {
  assert.deepEqual(matchedAmenities(listing('Appartement 2 chambres au centre'), 3), []);
  assert.deepEqual(matchedAmenities(listing(''), 3), []);
  assert.deepEqual(matchedAmenities({ title: null, description: null }, 3), []);
});

test('"immeuble" does not count as "meublé" (real false positive)', () => {
  // The leading word boundary is what prevents this: a plain substring check
  // on "meuble" matches inside "immeuble" (building). Confirmed live before
  // the boundary existed — see lib/constants.js's own note.
  const keys = matchedAmenityKeys(listing('Appartement dans un immeuble récent'), 3);
  assert.ok(!keys.includes('furnished'), `expected no furnished match, got ${JSON.stringify(keys)}`);
});

test('French inflections still match (no trailing boundary)', () => {
  const keys = matchedAmenityKeys(listing('Chambres climatisées et meublées'), 3);
  assert.ok(keys.includes('ac'), `expected ac, got ${JSON.stringify(keys)}`);
  assert.ok(keys.includes('furnished'), `expected furnished, got ${JSON.stringify(keys)}`);
});

test('the cap is honoured — a card has room for three chips, not eight', () => {
  const busy = listing('forage, groupe électrogène, climatisation, parking, gardien, meublé');
  assert.equal(matchedAmenities(busy, 3).length, 3);
  assert.equal(matchedAmenities(busy, 2).length, 2);
});

test('matchedAmenityKeys keeps its array-of-strings contract', () => {
  // The detail page (app/(site)/listings/[id]/page.js) still calls this shape.
  const keys = matchedAmenityKeys(listing('avec citerne et parking'), 3);
  assert.deepEqual(keys, ['borehole', 'parking']);
  assert.ok(keys.every((k) => typeof k === 'string'));
});

/**
 * The card's green freshness line says "Publiée", never "Vérifiée": every
 * live listing has genuinely passed human moderation (approve_status = 1),
 * but `created_at` records publication, not a verification event, and there
 * is no verification timestamp in the schema to date that claim from.
 */
test('freshness is computed from real calendar days and never claims verification', () => {
  const today = new Date();
  assert.equal(formatFreshness(today.toISOString()), "Publiée aujourd'hui");

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(formatFreshness(yesterday.toISOString()), 'Publiée hier');

  const older = new Date(today);
  older.setDate(older.getDate() - 30);
  assert.match(formatFreshness(older.toISOString()), /^Publiée le /);

  for (const value of [null, undefined, '', 'not-a-date']) {
    assert.equal(formatFreshness(value), null);
  }

  const all = [today, yesterday, older].map((d) => formatFreshness(d.toISOString()));
  assert.ok(all.every((s) => !/[Vv]érifi/.test(s)), 'freshness must never claim verification');
});
