import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as listings from '@/lib/listings';
import { calls, reset } from '../support/fakePool.js';
import { ALL_CITIES, isAllCities, searchCityOf } from '@/lib/cities';
import { normaliseSearchAliases } from '@/lib/searchAliases';
import { seoPathForParams } from '@/lib/seoPages';
import fr from '../../lib/i18n/fr.json' with { type: 'json' };
import en from '../../lib/i18n/en.json' with { type: 'json' };

/*
 * The hero's Ville select (2026-10-24): Kinshasa by default, "Toutes les
 * villes" a real nationwide search (ville=toutes), and ?city= / ?location=
 * accepted as aliases of the real ville / commune params.
 */
const WEB = path.resolve(import.meta.dirname, '../..');
const CITY_SQL = /p\.city_id IN \(SELECT city_id FROM property_city_contents/;

test.beforeEach(() => reset());

test('"toutes" is every city — unless a commune names one', () => {
  assert.ok(isAllCities('toutes'));
  assert.ok(isAllCities(' Toutes '));
  assert.ok(!isAllCities('Kinshasa'));
  assert.equal(searchCityOf({ ville: ALL_CITIES }), null);
  assert.equal(searchCityOf({ ville: ALL_CITIES, commune: 'Gombe' }), 'Kinshasa');
  assert.equal(searchCityOf({ ville: ALL_CITIES, commune: 'Kampemba' }), 'Lubumbashi');
  // Unchanged: no ville is still Kinshasa, so every existing link means the same.
  assert.equal(searchCityOf({}), 'Kinshasa');
});

test('a nationwide feed carries no city clause; a Kinshasa one still does', async () => {
  await listings.getListings({ ville: ALL_CITIES });
  assert.doesNotMatch(calls.map((c) => c.sql).join('\n'), CITY_SQL);
  reset();
  await listings.getListings({ ville: ALL_CITIES, commune: 'Gombe' });
  assert.match(calls.map((c) => c.sql).join('\n'), CITY_SQL);
  reset();
  await listings.getListings({});
  assert.match(calls.map((c) => c.sql).join('\n'), CITY_SQL);
});

test('a nationwide search is never a landing page canonical', () => {
  assert.equal(seoPathForParams({ transaction_type: 'location', ville: ALL_CITIES }), null);
});

test('?city= and ?location= read onto ville / commune', () => {
  const read = (qs) => Object.fromEntries(new URLSearchParams(normaliseSearchAliases(qs)));
  assert.equal(normaliseSearchAliases('transaction_type=location&commune=Gombe'), null, 'no alias, nothing to redirect');
  assert.deepEqual(read('city=Kinshasa&location=Gombe'), { commune: 'Gombe' });
  assert.deepEqual(read('city=Lubumbashi&location=Kampemba'), { ville: 'Lubumbashi', commune: 'Kampemba' });
  assert.deepEqual(read('city=Toutes%20les%20villes'), { ville: ALL_CITIES });
  assert.deepEqual(read('city=toutes&location=Gombe'), { commune: 'Gombe' });
  assert.deepEqual(read('city=goma&transaction_type=vente'), { ville: 'Goma', transaction_type: 'vente' });
  assert.deepEqual(read('city=Atlantis'), {}, 'an unknown city is dropped, not searched');
  assert.deepEqual(read('location=Binza%20Ozone'), { commune: 'Ngaliema', quartier: 'Binza Ozone' });
  // An explicit real param wins over its alias.
  assert.deepEqual(read('ville=Goma&city=Bukavu'), { ville: 'Goma' });
  assert.deepEqual(read('commune=Gombe&location=Lemba'), { commune: 'Gombe' });
});

test('middleware redirects only /listings URLs carrying an alias', () => {
  const src = fs.readFileSync(path.join(WEB, 'middleware.js'), 'utf8');
  assert.match(src, /source: '\/listings', has: \[\{ type: 'query', key: 'city' \}\]/);
  assert.match(src, /source: '\/listings', has: \[\{ type: 'query', key: 'location' \}\]/);
  assert.match(src, /normaliseSearchAliases\(request\.nextUrl\.searchParams\)/);
  assert.match(src, /NextResponse\.redirect\(target, 308\)/);
});

test('the hero lists the requested cities, Kinshasa first, then every city', () => {
  const src = fs.readFileSync(path.join(WEB, 'components/SearchBar.js'), 'utf8');
  assert.match(src, /const CITY_OPTIONS = \[\s*DEFAULT_CITY,\s*ALL_CITIES,/);
  assert.match(src, /HERO_CITY_ORDER = \['Lubumbashi', 'Goma', 'Bukavu', 'Kisangani', 'Kolwezi', 'Matadi', 'Mbuji-Mayi'\]/);
  assert.match(src, /useState\(DEFAULT_CITY\)/);
  assert.equal(fr.home.search.allCities, 'Toutes les villes');
  assert.equal(fr.home.search.locationLabel, 'Commune ou quartier');
  assert.ok(en.home.search.allCities);
  assert.equal(fr.listings.city.all, 'Toutes les villes');
  assert.match(fr.listings.results.headingNational, /\{subject\} \{transaction\} en RDC/);
});
