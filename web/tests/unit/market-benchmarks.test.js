import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summariseRow,
  communesRepresented,
  benchmarkTotals,
  MIN_SAMPLE,
  getMarketBenchmarks,
} from '@/lib/marketBenchmarks';
import { calls, reset, enqueue } from '../support/fakePool.js';

/**
 * The benchmark table's whole value is that a figure printed here can be
 * quoted to a bank. That makes the SUPPRESSION rule the thing most worth
 * pinning: a "median" of two sales is not a median, and publishing one would
 * make the dataset worth less than nothing.
 *
 * Asserted on the emitted SQL as well as on the rows, for the same reason
 * data-export.test.js does: a row-comparison test passes just as happily with
 * a filter deleted, as long as the fixture holds no rows that would have been
 * caught by it.
 */

test.beforeEach(() => reset());

function row(overrides = {}) {
  return {
    commune: 'Gombe',
    purpose: 'sale',
    property_type: 'Maison',
    sample: 8,
    median_asking: '120000',
    median_achieved: '110000',
    median_delta_pct: '-8.3',
    median_days_on_market: '64',
    ...overrides,
  };
}

test('a cell at or above the minimum sample reports real medians', () => {
  const out = summariseRow(row({ sample: MIN_SAMPLE }));
  assert.equal(out.suppressed, false);
  assert.equal(out.medianAsking, 120000);
  assert.equal(out.medianAchieved, 110000);
  assert.equal(out.medianDeltaPct, -8.3);
  assert.equal(out.medianDaysOnMarket, 64);
});

test('a cell below the minimum sample is suppressed, medians and all', () => {
  const out = summariseRow(row({ sample: MIN_SAMPLE - 1 }));
  assert.equal(out.suppressed, true);
  for (const field of ['medianAsking', 'medianAchieved', 'medianDeltaPct', 'medianDaysOnMarket']) {
    assert.equal(out[field], null, `${field} must not survive suppression`);
  }
});

test('a suppressed cell still reports its real count', () => {
  // "3 ventes, pas encore assez pour une médiane" is useful and true.
  // Hiding the row entirely would read as "no activity here", which is not.
  const out = summariseRow(row({ sample: 3 }));
  assert.equal(out.sample, 3);
  assert.equal(out.suppressed, true);
});

test('numeric strings from node-pg become real numbers', () => {
  // pg returns NUMERIC as a string; a median rendered straight from that
  // would sort and format as text.
  const out = summariseRow(row());
  for (const field of ['medianAsking', 'medianAchieved', 'medianDeltaPct', 'medianDaysOnMarket']) {
    assert.equal(typeof out[field], 'number', `${field} must be a number`);
  }
});

test('a null median stays null rather than becoming zero', () => {
  // Number(null) is 0, and a 0% negotiation gap is a real, wrong claim.
  const out = summariseRow(row({ median_delta_pct: null }));
  assert.equal(out.medianDeltaPct, null);
});

test('a missing property type is null, never invented', () => {
  const out = summariseRow(row({ property_type: null }));
  assert.equal(out.propertyType, null);
});

test('communes are derived from the rows, never hardcoded', () => {
  const rows = [
    summariseRow(row({ commune: 'Gombe' })),
    summariseRow(row({ commune: 'Ngaliema', purpose: 'rent' })),
    summariseRow(row({ commune: 'Gombe', purpose: 'rent' })),
  ];
  assert.deepEqual(communesRepresented(rows), ['Gombe', 'Ngaliema']);
});

test('a commune present only through suppressed cells is still represented', () => {
  // Otherwise the first sale in a new commune is invisible until the fifth.
  const rows = [summariseRow(row({ commune: 'Lingwala', sample: 1 }))];
  assert.deepEqual(communesRepresented(rows), ['Lingwala']);
});

test('totals separate what exists from what can actually be quoted', () => {
  const rows = [
    summariseRow(row({ sample: 9 })),
    summariseRow(row({ commune: 'Ngaliema', sample: 2 })),
    summariseRow(row({ commune: 'Lingwala', sample: 1 })),
  ];
  const totals = benchmarkTotals(rows);
  assert.equal(totals.transactions, 12, 'every real sale counts toward the total');
  assert.equal(totals.cells, 3);
  assert.equal(totals.reportable, 1, 'only the cell clearing MIN_SAMPLE is quotable');
  assert.equal(totals.communes, 3);
});

test('an empty market reports zeroes rather than throwing', () => {
  const totals = benchmarkTotals([]);
  assert.deepEqual(totals, { transactions: 0, cells: 0, reportable: 0, communes: 0 });
});

async function emittedSql() {
  enqueue([]);
  await getMarketBenchmarks();
  return calls[calls.length - 1].text;
}

test('the query counts only genuinely closed sales, and never imputes a price', async () => {
  const sql = await emittedSql();

  assert.match(sql, /listing_status = 'closed'/, 'only closed transactions are benchmarked');
  assert.match(sql, /p\.sold_price IS NOT NULL/, 'a close with no recorded figure cannot contribute');
  assert.match(sql, /p\.price IS NOT NULL/, 'nor can one with no asking price to compare against');
});

test('the query keeps sold listings in scope by filtering on approve_status only', async () => {
  // The one deliberate departure from the public gate, mirroring
  // lib/dataExport.js: closing a transaction sets status = 0, so filtering on
  // `status` here would drop the entire dataset this page is made of.
  const sql = await emittedSql();
  assert.match(sql, /p\.approve_status = 1/);
  assert.ok(
    !/p\.status\s*=\s*1/.test(sql),
    'filtering on status would silently drop every sold listing',
  );
});

test('medians are computed in the database, not approximated in JS', async () => {
  const sql = await emittedSql();
  assert.match(sql, /PERCENTILE_CONT\(0\.5\)/);
  // An average is not a median, and is exactly what a small skewed sample
  // punishes hardest.
  assert.ok(!/\bAVG\(/i.test(sql), 'a mean would misreport a skewed sample as a typical price');
});
