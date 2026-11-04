import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as listings from '@/lib/listings';
import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  SIMILAR_PRICE_HIGH,
  SIMILAR_PRICE_LOW,
  similarAlertQuery,
  similarPriceRange,
  transactionTypeOfPurpose,
} from '@/lib/similarSearch';
import { homeAlertCommunes, homeAlertQuery } from '@/lib/homeAlert';
import { nudgeAllowedOn } from '@/lib/signupNudgeRules';

/**
 * 2026-11-04 landing pass: "Biens similaires" keeps rent with rent and a
 * price band, "M'alerter des biens similaires" on the listing page, the
 * homepage alert + "Trouver pour moi" band, the "N nouveaux biens en
 * 7 jours" pill, the folded phone search, the signup benefits, and the
 * signup reminder off the search box on /listings.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const fr = JSON.parse(read('../../lib/i18n/fr.json'));
const en = JSON.parse(read('../../lib/i18n/en.json'));
const APPROVED = 'p.status = 1 AND p.approve_status = 1';

test.beforeEach(() => reset());

// --- similar listings --------------------------------------------------------

test('getSimilarListings keeps the purpose, the rent period and a price band', async () => {
  enqueue([]);
  await listings.getSimilarListings(653, 6);
  assert.equal(calls.length, 1);
  const { sql, values: params } = calls[0];
  assert.ok(sql.includes(APPROVED), 'public gate');
  assert.match(sql, /p\.purpose IS NOT DISTINCT FROM src\.purpose/);
  assert.match(sql, /COALESCE\(NULLIF\(p\.price_period, ''\), 'mois'\) = COALESCE\(NULLIF\(src\.price_period, ''\), 'mois'\)/);
  assert.match(sql, /p\.price BETWEEN src\.price \* \$3 AND src\.price \* \$4/);
  assert.match(sql, /ORDER BY p\.embedding <=> src\.embedding/);
  assert.deepEqual(params, [653, 6, SIMILAR_PRICE_LOW, SIMILAR_PRICE_HIGH]);
});

test('the listing page fallbacks keep rent with rent', () => {
  const page = read('../../app/(site)/listings/[id]/page.js');
  assert.match(page, /getListings\(\{ commune: listing\.commune, transactionType, excludeId/);
  assert.match(page, /getListings\(\{ transactionType, excludeId/);
  assert.equal(transactionTypeOfPurpose('rent'), 'location');
  assert.equal(transactionTypeOfPurpose('sale'), 'vente');
  assert.equal(transactionTypeOfPurpose(null), null);
});

test('the price band is 70–130 % and refuses a missing price', () => {
  assert.deepEqual(similarPriceRange(800), { min: 560, max: 1040 });
  assert.equal(similarPriceRange(0), null);
  assert.equal(similarPriceRange(null), null);
  assert.equal(similarPriceRange('abc'), null);
});

// --- "M'alerter des biens similaires" ----------------------------------------

test('the similar alert searches what the listing states', () => {
  const query = similarAlertQuery({
    purpose: 'rent', commune: 'Lingwala', category_name: 'Appartement', beds: 3, price: 800, price_period: 'mois', city_name: 'Kinshasa',
  });
  assert.equal(query, 'transaction_type=location&commune=Lingwala&property_type=appartement&beds_min=3&price_min=560&price_max=1040');
});

test('the similar alert leaves out what the listing does not state', () => {
  assert.equal(
    similarAlertQuery({ purpose: 'sale', commune: 'Gombe', price: 250000 }),
    'transaction_type=vente&commune=Gombe&price_min=175000&price_max=325000',
  );
  // A yearly rent gets no monthly band; a daily one is a short stay.
  assert.equal(similarAlertQuery({ purpose: 'rent', commune: 'Gombe', price: 9000, price_period: 'an' }), 'transaction_type=location&commune=Gombe');
  assert.equal(similarAlertQuery({ purpose: 'rent', commune: 'Gombe', price: 50, price_period: 'jour' }), 'transaction_type=location&commune=Gombe&lease_term=short');
  // Outside Kinshasa the city is part of the search.
  assert.match(similarAlertQuery({ purpose: 'rent', commune: 'Kampemba', city_name: 'Lubumbashi' }), /ville=Lubumbashi/);
});

test('no similar alert on the whole catalogue or an unknown purpose', () => {
  assert.equal(similarAlertQuery({ purpose: 'rent' }), null);
  assert.equal(similarAlertQuery({ purpose: 'swap', commune: 'Gombe' }), null);
  assert.equal(similarAlertQuery(null), null);
});

test('a guest alert returns to the results with the resume marker SaveSearchButton reads', () => {
  const button = read('../../components/QueryAlertButton.js');
  assert.match(button, /next=\{`\$\{href\}&lkp_auth_return=alert`\}/);
  const save = read('../../components/SaveSearchButton.js');
  assert.match(save, /resumeKey = variant === 'pill' \? 'alert' : 'save'/);
  // The pill that resumes it is mounted on /listings at every width (hidden by CSS from lg).
  const bar = read('../../components/FloatingControlBar.js');
  assert.match(bar, /<SaveSearchButton variant="pill" \/>/);
});

// --- homepage ----------------------------------------------------------------

test('the homepage alert needs a commune and uses /listings param names', () => {
  assert.equal(homeAlertQuery({ transaction: 'location', commune: '' }), null);
  assert.equal(homeAlertQuery({ transaction: 'location', commune: 'Gombe', price_max: '1000' }), 'transaction_type=location&commune=Gombe&price_max=1000');
  assert.equal(homeAlertQuery({ transaction: 'vente', commune: 'Limete' }), 'transaction_type=vente&commune=Limete');
  assert.equal(homeAlertQuery({ transaction: 'anything', commune: 'Limete' }), 'transaction_type=location&commune=Limete');
});

test('the homepage alert offers Kinshasa communes, those with listings first', () => {
  const { popular, others } = homeAlertCommunes(
    [{ commune: 'Limete', count: 69 }, { commune: 'Lubumbashi', count: 16 }, { commune: 'Gombe', count: 41 }],
    ['Gombe', 'Limete', 'Barumbu', 'Bandalungwa'],
  );
  assert.deepEqual(popular, [{ commune: 'Limete', count: 69 }, { commune: 'Gombe', count: 41 }]);
  assert.deepEqual(others, ['Bandalungwa', 'Barumbu']);
});

test('the weekly count is public listings published in the last N days', async () => {
  enqueue([{ n: '42' }]);
  const n = await listings.countListingsPublishedSince(7);
  assert.equal(n, 42);
  assert.ok(calls[0].sql.includes(APPROVED));
  assert.match(calls[0].sql, /GREATEST\(p\.created_at/);
  assert.deepEqual(calls[0].values, [7]);
  const hero = read('../../components/Hero.js');
  assert.match(hero, /weeklyNew > 0 \?/, 'nothing shown at 0');
});

test('the phone search folds Ville, Type and Budget, never on sm and up', () => {
  const bar = read('../../components/SearchBar.js');
  assert.match(bar, /const folded = moreOpen \? '' : 'max-sm:hidden'/);
  assert.equal((bar.match(/\$\{folded\}/g) || []).length, 3);
  assert.match(bar, /aria-expanded=\{moreOpen\}/);
});

test('the homepage renders the alert band', () => {
  const page = read('../../app/(site)/(home)/page.js');
  assert.match(page, /<HomeAlertBand \/>/);
  assert.match(page, /cachedWeeklyNewCount\(\)\.catch\(\(\) => 0\)/);
});

// --- signup & reminder -------------------------------------------------------

test('the signup page names what an account does', () => {
  const page = read('../../app/(site)/compte/inscription/page.js');
  assert.match(page, /\['alerts', 'favorites', 'priceDrops'\]/);
});

test('the signup reminder docks at the bottom on /listings', () => {
  const nudge = read('../../components/SignupNudge.js');
  assert.match(nudge, /startsWith\('\/listings'\)/);
  assert.match(nudge, /bottom-\[5\.5rem\]/);
  assert.equal(nudgeAllowedOn('/listings', 'commune=Gombe'), true);
});

// --- copy ----------------------------------------------------------------------

test('every new string exists in French and English', () => {
  for (const dict of [fr, en]) {
    for (const key of ['moreCriteria', 'fewerCriteria']) assert.ok(dict.home.search[key], key);
    assert.ok(dict.home.hero.weeklyNew.one && dict.home.hero.weeklyNew.other);
    for (const key of ['heading', 'alertTitle', 'alertLead', 'commune', 'communePlaceholder', 'withListings', 'otherCommunes', 'budget', 'button', 'pickCommune', 'requestTitle', 'requestLead', 'requestButton']) {
      assert.ok(dict.home.alertBand[key], `home.alertBand.${key}`);
    }
    assert.ok(dict.listings.alert.createdSee);
    for (const key of ['title', 'lead', 'button', 'inlineLead']) assert.ok(dict.listings.similarAlert[key], key);
    for (const key of ['alerts', 'favorites', 'priceDrops']) assert.ok(dict.auth.signupBenefits[key], key);
  }
  // The pill states a rolling window, not a calendar week.
  assert.match(fr.home.hero.weeklyNew.other, /7 jours/);
});
