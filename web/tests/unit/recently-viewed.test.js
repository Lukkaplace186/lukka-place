import { test } from 'node:test';
import assert from 'node:assert/strict';

// A minimal browser: lib/recentlyViewed.js only touches window.localStorage
// and window's storage listeners.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  },
  addEventListener() {},
  removeEventListener() {},
};

const { rememberViewed, getRecentIds, RECENT_LIMIT } = await import('../../lib/recentlyViewed.js');

test('newest first, a repeat view moves to the front instead of duplicating', () => {
  store.clear();
  rememberViewed(5);
  rememberViewed(7);
  rememberViewed(5);
  assert.deepEqual(getRecentIds(), ['5', '7']);
});

test('keeps at most RECENT_LIMIT ids', () => {
  store.clear();
  for (let id = 1; id <= RECENT_LIMIT + 5; id += 1) rememberViewed(id);
  const ids = getRecentIds();
  assert.equal(ids.length, RECENT_LIMIT);
  assert.equal(ids[0], String(RECENT_LIMIT + 5));
});

test('ignores anything that is not a listing id, and survives corrupt storage', () => {
  store.clear();
  rememberViewed('abc');
  rememberViewed(null);
  assert.deepEqual(getRecentIds(), []);
  store.set('lukka:recently-viewed', '{not json');
  assert.deepEqual(getRecentIds(), []);
  store.set('lukka:recently-viewed', JSON.stringify(['12', 'x', 3]));
  assert.deepEqual(getRecentIds(), ['12', '3']);
});

test('a storage that throws (private window) never breaks the page', () => {
  const original = globalThis.window.localStorage;
  globalThis.window.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => rememberViewed(9));
  assert.deepEqual(getRecentIds(), []);
  globalThis.window.localStorage = original;
});
