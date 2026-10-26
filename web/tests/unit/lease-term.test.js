import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as listings from '@/lib/listings';
import * as leaseTerm from '@/lib/leaseTerm';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { parseSearchQuery } from '@/lib/searchParser';
import { formatPrice } from '@/lib/format';
import { compactPrice } from '@/lib/mapIcons';
import { comparablePrice } from '@/lib/demandRules';
import { calls, reset } from '../support/fakePool.js';

/**
 * Short-term (by the day / week) vs long-term rentals — lib/leaseTerm.js and
 * the engine's services/leaseTerm.js. The fact lives in `price_period`.
 */

const require = createRequire(import.meta.url);
const engine = require('../../../services/leaseTerm.js');

test.beforeEach(() => reset());

test('web and engine agree on the vocabulary and the SQL', () => {
  assert.deepEqual(leaseTerm.SHORT_TERM_PERIODS, engine.SHORT_TERM_PERIODS);
  assert.deepEqual(leaseTerm.LEASE_TERMS, engine.LEASE_TERMS);
  assert.equal(leaseTerm.shortTermSql('p'), engine.shortTermSql('p'));
  assert.equal(leaseTerm.longTermSql('p'), engine.longTermSql('p'));
  for (const period of ['jour', 'semaine', 'an', 'mois', null, 'total']) {
    assert.equal(` ${leaseTerm.rentPeriodLabel(period)}`, period === 'total' ? ' / mois' : engine.periodSuffix(period));
  }
});

test('?lease_term=short filters rents priced per day or week; long keeps an unset period', async () => {
  await listings.getListings(parseListingsSearchParams(new URLSearchParams('lease_term=short')));
  const shortSql = calls.map((c) => c.sql).join('\n');
  assert.ok(shortSql.includes("p.price_period IN ('jour', 'semaine')"));
  assert.ok(shortSql.includes("p.purpose = 'rent'"));
  assert.ok(shortSql.includes('p.status = 1 AND p.approve_status = 1'));

  reset();
  await listings.getListings({ leaseTerm: 'long' });
  const longSql = calls.map((c) => c.sql).join('\n');
  assert.ok(longSql.includes("COALESCE(p.price_period, 'mois') NOT IN ('jour', 'semaine')"), 'a rent with no period is long term');

  reset();
  await listings.getListings({ leaseTerm: 'nightly; DROP' });
  assert.ok(!calls.map((c) => c.sql).join('\n').includes("'jour'"), 'an unknown value filters nothing');
});

test('the search box understands short and long term in French and English', () => {
  for (const text of ['studio à la journée Gombe', 'chambre 40$ par nuit', 'appartement 50$/jour', 'courte durée Limete', 'short term flat']) {
    const parsed = parseSearchQuery(text);
    assert.equal(parsed.lease_term, 'short', text);
    assert.equal(parsed.transaction_type, 'location', `${text}: a lease is a rental`);
  }
  assert.equal(parseSearchQuery('appartement longue durée Ngaliema').lease_term, 'long');
  assert.equal(parseSearchQuery('appartement 50$/jour').price_max, 50, 'the price survives the period');
  assert.equal(parseSearchQuery('2 chambres Gombe 800$').lease_term, undefined, 'nothing said, nothing set');
  assert.equal(parseSearchQuery('bonjour').lease_term, undefined, '"jour" inside a word is not a period');
});

test('a short-term price says per day / week everywhere, and never counts as a monthly rent', () => {
  assert.equal(formatPrice(40, 'rent', 'jour'), '40 $ / jour');
  assert.equal(formatPrice(200, 'rent', 'semaine'), '200 $ / semaine');
  assert.equal(formatPrice(800, 'rent', null), '800 $ / mois', 'long term is the default');
  assert.equal(compactPrice(40, 'rent', { pricePeriod: 'jour' }), '$40/j');
  assert.equal(compactPrice(200, 'rent', { pricePeriod: 'semaine' }), '$200/sem');
  assert.equal(comparablePrice({ purpose: 'rent', price: 40, price_period: 'jour' }), null);
  assert.equal(comparablePrice({ purpose: 'rent', price: 1200, price_period: 'an' }), 100);
});
