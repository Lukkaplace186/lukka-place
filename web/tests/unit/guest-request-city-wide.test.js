// "Toute la ville" on the no-account request form (2026-11-25): picking
// "Kinshasa" meant the city for most visitors but routed the request to the
// Commune de Kinshasa's agencies only. The city-wide choice makes a request
// with no commune and city = Kinshasa, which the engine offers city-wide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUEST_CITY, GUEST_CITY_WIDE, guestCommuneLabel, parseGuestRequest } from '@/lib/guestRequestRules';

const COMMUNES = ['Gombe', 'Kinshasa', 'Limete'];

test('the city-wide choice parses as a request with no commune and the city set', () => {
  const r = parseGuestRequest({ transactionType: 'location', commune: GUEST_CITY_WIDE, budgetMax: '300' }, COMMUNES);
  assert.equal(r.ok, true);
  assert.equal(r.request.commune, null);
  assert.equal(r.request.city, GUEST_CITY);
  assert.equal(r.request.budgetMax, 300);
});

test('the Commune de Kinshasa is still a commune request, with no city', () => {
  const r = parseGuestRequest({ transactionType: 'location', commune: 'Kinshasa' }, COMMUNES);
  assert.equal(r.ok, true);
  assert.equal(r.request.commune, 'Kinshasa');
  assert.equal(r.request.city, null);
});

test('an unknown value is still refused', () => {
  assert.deepEqual(parseGuestRequest({ transactionType: 'location', commune: 'toute-la-planete' }, COMMUNES), { ok: false, error: 'commune' });
});

test('only the commune named like the city gets the (commune) label', () => {
  assert.equal(guestCommuneLabel('Kinshasa'), 'Kinshasa (commune)');
  assert.equal(guestCommuneLabel('Gombe'), 'Gombe');
});

test('the action sends a city-wide request with no commune and the city, and both dictionaries name the choice', () => {
  const action = readFileSync(new URL('../../app/(site)/trouver-pour-moi/actions.js', import.meta.url), 'utf8');
  assert.match(action, /communes: request\.commune \? \[request\.commune\] : \[\]/);
  assert.match(action, /city: request\.city \|\| undefined/);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(readFileSync(new URL(`../../lib/i18n/${lang}.json`, import.meta.url), 'utf8'));
    assert.match(dict.listings.guestRequest.cityWide, /\{city\}/, `${lang}.json listings.guestRequest.cityWide`);
  }
});
