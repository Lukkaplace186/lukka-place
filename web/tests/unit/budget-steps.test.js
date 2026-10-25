import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OVER, RENT_BUDGET_STEPS, SALE_MAX_STEPS, SALE_MIN_STEPS, budgetOptions, budgetParams } from '@/lib/budgetSteps';

const labels = {
  minAny: 'Min',
  maxAny: 'Max',
  min: (a) => `Min ${a} $`,
  max: (a) => `Max ${a} $`,
  over: (a) => `${a} $ +`,
};
const format = (a) => String(a);

test('rent steps are the owner list: $100 steps to 1 000, then up to 10 000', () => {
  assert.deepEqual(RENT_BUDGET_STEPS, [
    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    1250, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
  ]);
});

test('a range is sent as both bounds; "10 000 $ +" as a max sends no ceiling', () => {
  assert.deepEqual(budgetParams('200', '300'), { price_min: '200', price_max: '300' });
  assert.deepEqual(budgetParams('', '300'), { price_min: '', price_max: '300' });
  assert.deepEqual(budgetParams('5000', OVER), { price_min: '5000', price_max: '' });
  assert.deepEqual(budgetParams('', ''), { price_min: '', price_max: '' });
});

test('a min above the max never reaches the URL as a contradiction', () => {
  assert.deepEqual(budgetParams('800', '300'), { price_min: '800', price_max: '' });
});

test('options: the top step reads "+" and contradicting choices are disabled', () => {
  const { minOptions, maxOptions } = budgetOptions('rent', { min: '500', max: '' }, format, labels);
  assert.equal(minOptions[0].label, 'Min');
  assert.equal(minOptions.at(-1).label, '10000 $ +');
  assert.equal(maxOptions.at(-1).value, OVER);
  assert.equal(maxOptions.at(-1).label, '10000 $ +');
  assert.equal(maxOptions.find((o) => o.value === '300').disabled, true);
  assert.equal(maxOptions.find((o) => o.value === '600').disabled, false);

  const capped = budgetOptions('rent', { min: '', max: '300' }, format, labels);
  assert.equal(capped.minOptions.find((o) => o.value === '400').disabled, true);
  assert.equal(capped.minOptions.find((o) => o.value === '200').disabled, false);
});

test('the hero card sends price_min and price_max, not a max alone', () => {
  const source = readFileSync(new URL('../../components/SearchBar.js', import.meta.url), 'utf8');
  assert.match(source, /price_min: stagedMin/);
  assert.match(source, /price_max: stagedMax/);
  assert.match(source, /id="hero-budget-min"/);
  assert.match(source, /id="hero-budget-max"/);
});

test('Acheter (vente) uses the owner sale tiers, never the rent steps', () => {
  assert.deepEqual(SALE_MIN_STEPS, [10000, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000]);
  assert.deepEqual(SALE_MAX_STEPS, [25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000]);
  // The hero's Acheter tab sends 'vente' (lib/constants.js); checking only 'sale' showed rent steps there.
  for (const tx of ['vente', 'sale']) {
    const { minOptions, maxOptions } = budgetOptions(tx, {}, format, labels);
    assert.equal(minOptions[1].value, '10000', tx);
    assert.equal(minOptions.at(-1).label, '1000000 $ +', tx);
    assert.equal(maxOptions[1].value, '25000', tx);
    assert.equal(maxOptions.at(-2).label, 'Max 1000000 $', tx);
    assert.equal(maxOptions.at(-1).value, OVER, tx);
    assert.equal(maxOptions.at(-1).label, '1000000 $ +', tx);
  }
  assert.equal(budgetOptions('location', {}, format, labels).minOptions[1].value, '100');
});
