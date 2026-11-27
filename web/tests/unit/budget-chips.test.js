// Budget chips under the rental search bar (2026-11-25, lib/budgetChips.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUDGET_CHIPS, activeBudgetChip, budgetChipToggle, showBudgetChips } from '@/lib/budgetChips';

test('a chip is on only when the price filter is exactly its range', () => {
  assert.equal(activeBudgetChip('', '200')?.key, 'under200');
  assert.equal(activeBudgetChip('200', '400')?.key, 'from200to400');
  assert.equal(activeBudgetChip('', '750'), null, 'the ad landing (max 750, no min) is not the 400–750 chip');
  assert.equal(activeBudgetChip('', ''), null);
});

test('tapping a chip sets its range; tapping it again clears both ends', () => {
  const chip = BUDGET_CHIPS.find((c) => c.key === 'from200to400');
  assert.deepEqual(budgetChipToggle(chip, '', '750'), { min: '200', max: '400' });
  assert.deepEqual(budgetChipToggle(chip, '200', '400'), { min: '', max: '' });
});

test('chips show on monthly rentals only', () => {
  assert.equal(showBudgetChips('location', ''), true);
  assert.equal(showBudgetChips('', 'long'), true);
  assert.equal(showBudgetChips('vente', ''), false);
  assert.equal(showBudgetChips('location', 'short'), false);
});

test('the search bar renders the chips and both dictionaries name every chip', () => {
  const bar = readFileSync(new URL('../../components/FilterBar.js', import.meta.url), 'utf8');
  assert.match(bar, /showBudgetChips\(transaction, leaseTerm\)/);
  assert.match(bar, /onClick=\{\(\) => chooseBudget\(chip\)\}/);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(readFileSync(new URL(`../../lib/i18n/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of ['label', ...BUDGET_CHIPS.map((c) => c.key)]) {
      assert.ok(dict.listings.budgetChips?.[key], `${lang}.json listings.budgetChips.${key}`);
    }
  }
});
