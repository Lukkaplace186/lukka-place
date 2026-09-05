import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, LISTING_EXPORT_COLUMNS, getListingExportRows } from '@/lib/dataExport';
import { calls, reset } from '../support/fakePool.js';

/**
 * The export is a published contract — consumers key spreadsheets on these
 * column names — so both the names and the escaping are pinned.
 */

test.beforeEach(() => reset());

test('the column contract is stable and starts with the join key', () => {
  assert.equal(LISTING_EXPORT_COLUMNS[0], 'property_id');
  assert.equal(new Set(LISTING_EXPORT_COLUMNS).size, LISTING_EXPORT_COLUMNS.length, 'no duplicate columns');
  // The commercially distinctive figures — nothing else captures negotiation.
  for (const col of ['asking_price_usd', 'sold_price_usd', 'price_delta_pct', 'days_on_market']) {
    assert.ok(LISTING_EXPORT_COLUMNS.includes(col), `${col} must be in the contract`);
  }
});

test('a value containing a comma is quoted, not allowed to shift later columns', () => {
  // Real data: "Yolo Sud I, Kalamu". A naive join corrupts every column
  // after this one, on exactly the rows a buyer would spot-check.
  const csv = toCsv([{ property_id: 1, commune: 'Yolo Sud I, Kalamu' }], ['property_id', 'commune']);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '1,"Yolo Sud I, Kalamu"');
});

test('embedded quotes are doubled per RFC 4180', () => {
  const csv = toCsv([{ a: 'Résidence "Le Palmier"' }], ['a']);
  assert.match(csv, /"Résidence ""Le Palmier"""/);
});

test('a newline inside a value stays inside one CSV record', () => {
  const csv = toCsv([{ a: 'ligne1\nligne2' }], ['a']);
  assert.match(csv, /"ligne1\nligne2"/);
});

test('null and undefined render as empty cells, never as the text "null"', () => {
  const csv = toCsv([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c']);
  assert.equal(csv.split('\r\n')[1], ',,0', 'a real zero must survive; absence must not become a word');
});

test('the file carries a UTF-8 BOM so Excel does not mojibake accented communes', () => {
  const csv = toCsv([{ a: 'Entrepôt' }], ['a']);
  assert.equal(csv.charCodeAt(0), 0xfeff, 'missing BOM makes Excel read this as ANSI');
});

test('the header row names every contract column in order', () => {
  const csv = toCsv([]);
  assert.equal(csv.replace('﻿', '').split('\r\n')[0], LISTING_EXPORT_COLUMNS.join(','));
});

test('the export covers only listings that were really on the market', async () => {
  await getListingExportRows();
  const sql = calls[0].sql;
  assert.match(sql, /WHERE p\.approve_status = 1/, 'unapproved listings were never on the market');
  // '0' is the stored "unknown" for the TEXT area column; exporting it as a
  // measurement would be fabricated data.
  assert.match(sql, /NULLIF\(NULLIF\(p\.area, '0'\), ''\)/);
  assert.match(sql, /price_delta_pct/);
});

/**
 * The one query in this app that deliberately does NOT apply the public
 * `status = 1 AND approve_status = 1` gate, and the reason is the whole
 * commercial point of the export.
 *
 * `status` became the visibility flag when archiving and transaction
 * recording landed: marking a listing sold sets it to 0 so a concluded
 * property leaves public search. If this query filtered on it, every SOLD
 * listing — precisely the rows carrying sold_price, sold_at and the
 * achieved-vs-asking delta — would silently vanish from the dataset, and the
 * export would quietly become a list of things that never transacted.
 *
 * Asserted on the SQL text rather than on returned rows for the same reason
 * listings-sql.test.js does: a row-comparison test passes just as happily
 * against a fixture that happens to contain no sold listings.
 */
test('sold and archived listings stay in the market export — status must NOT be filtered', async () => {
  await getListingExportRows();
  const sql = calls[0].sql;
  // Comments are stripped first: the doc comment right above the WHERE
  // clause quotes the very filter this asserts is absent, so matching the
  // raw text would fail on the explanation of why it is absent.
  const withoutComments = sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
  assert.doesNotMatch(
    withoutComments,
    /WHERE[\s\S]*p\.status = 1/,
    'filtering on p.status here drops every closed transaction from the dataset',
  );
  assert.match(sql, /\(p\.status = 1\) *AS currently_listed/, 'consumers still need to know what is live');
});

test('days on market uses the agent-recorded transaction date, not the last edit', async () => {
  await getListingExportRows();
  const sql = calls[0].sql;
  // updated_at moves every time anything on the row changes, so a listing
  // touched three months after closing reported a three-month-longer DOM.
  // sold_at is the real agreed date; updated_at survives only as the fallback
  // for rows closed before that column existed.
  assert.match(sql, /COALESCE\(p\.sold_at::timestamp, p\.updated_at\)/);
});
