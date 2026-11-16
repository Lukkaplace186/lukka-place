import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QUICK_EDIT_FIELDS, applyQuickEdit, changedFields, fixableBySkipReason, quickEditEntries, quickEditValues,
} from '@/lib/reviewQuickEdit';

// A review item as app/admin/listings/review/page.js builds it.
const ITEM = {
  id: 1041,
  title: 'Parcelle à vendre à Barumbu',
  price: 750000,
  pricePeriod: null,
  purpose: 'sale',
  commune: 'Barumbu',
  quartier: null,
  reference: 'terrain municipale, Bon-Marché',
  beds: null,
  flags: ['few_photos', 'missing_commune'],
  facts: {
    bath: null, area: '0', currency: 'USD', categoryId: 7, priceOriginal: 750000, listingStatus: 'active',
    depositMonths: null, advanceMonths: null, commissionMonths: null,
    parcelleSubtype: 'terrain_nu', categoryName: 'Terrain', description: 'Vente d’une parcelle…',
  },
};

const entriesOf = (pairs) => Object.fromEntries(pairs);

test('the form opens on the listing as stored; area "0" opens blank', () => {
  const values = quickEditValues(ITEM);
  assert.deepEqual(Object.keys(values).sort(), [...QUICK_EDIT_FIELDS].sort());
  assert.equal(values.area, '');
  assert.equal(values.price, '750000');
  assert.equal(values.category_id, '7');
  assert.equal(values.price_period, '');
});

test('nothing changed: nothing is sent', () => {
  const values = quickEditValues(ITEM);
  assert.deepEqual(quickEditEntries(values, { ...values }), []);
  // 750000 and 750000.00 are the same price
  assert.deepEqual(changedFields(values, { ...values, price: '750000.00' }), []);
});

test('one field changed: only it, plus the period and the listing status the action would otherwise clear', () => {
  const before = quickEditValues(ITEM);
  const sent = entriesOf(quickEditEntries(before, { ...before, beds: '3' }, { listingStatus: 'active' }));
  assert.deepEqual(sent, { beds: '3', price_period: '', listing_status: 'active' });
});

test('a quartier change sends the commune too (the address is rebuilt from both)', () => {
  const before = quickEditValues(ITEM);
  const sent = entriesOf(quickEditEntries(before, { ...before, quartier: 'Bon-Marché' }));
  assert.equal(sent.quartier, 'Bon-Marché');
  assert.equal(sent.commune, 'Barumbu');
});

test('a USD price change sends price and currency, never a stale price_original', () => {
  const before = quickEditValues(ITEM);
  const sent = entriesOf(quickEditEntries(before, { ...before, price: '700000' }));
  assert.equal(sent.price, '700000');
  assert.equal(sent.currency, 'USD');
  assert.equal('price_original' in sent, false);
});

test('a CDF price keeps the franc figure beside the dollar one', () => {
  const before = quickEditValues({ ...ITEM, facts: { ...ITEM.facts, currency: 'CDF', priceOriginal: 2000000 } });
  const sent = entriesOf(quickEditEntries(before, { ...before, price_original: '2500000' }));
  assert.equal(sent.price_original, '2500000');
  assert.equal(sent.price, '750000');
  assert.equal(sent.currency, 'CDF');
});

test('the price is untouched when only the title changes (no engine re-price)', () => {
  const before = quickEditValues(ITEM);
  const sent = entriesOf(quickEditEntries(before, { ...before, title: 'Parcelle à Barumbu' }));
  assert.equal('price' in sent, false);
  assert.equal(sent.title, 'Parcelle à Barumbu');
});

test('the screen shows the correction and drops the flags it settled, nothing else', () => {
  const before = quickEditValues({ ...ITEM, commune: null });
  const after = applyQuickEdit({ ...ITEM, commune: null }, { ...before, commune: 'Barumbu', beds: '2', category_id: '9' }, [{ id: 9, name: 'Maison' }]);
  assert.equal(after.commune, 'Barumbu');
  assert.equal(after.beds, 2);
  assert.equal(after.facts.categoryName, 'Maison');
  assert.deepEqual(after.flags, ['few_photos']);
  assert.equal(after.facts.area, '0');
});

test('approval refusals the editor can fix open it; a same-agent re-send does not', () => {
  assert.equal(fixableBySkipReason('Annonce #1 : le prix est absent ou nul. Corrigez-le avant de publier.'), true);
  assert.equal(fixableBySkipReason('Annonce #1 : contenu manquant (titre ou description). À rejeter plutôt qu\'à publier.'), true);
  assert.equal(fixableBySkipReason('Annonce #1 : le même agent a déjà ce bien (n° 2). Comparez avant d\'approuver.'), false);
});

test('the refusal wording matched above is still the action\'s wording', () => {
  const source = readFileSync(new URL('../../app/admin/listings/actions.js', import.meta.url), 'utf8');
  assert.match(source, /contenu manquant/);
  assert.match(source, /le prix est absent/);
  assert.match(source, /message d'erreur d'extraction/);
});
