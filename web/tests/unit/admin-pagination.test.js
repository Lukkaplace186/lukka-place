import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZES, buildHref, kinshasaDayEnd, kinshasaDayStart, pageWindow, parsePage, totalPages,
} from '@/lib/adminPagination';

/**
 * Every /admin table is a URL: page, size and filters are query params and the
 * database returns one page. These pin the rules that keep that honest.
 */

test('parsePage turns page/size into LIMIT/OFFSET and refuses sizes it does not offer', () => {
  assert.deepEqual(parsePage({ page: '3', size: '50' }), { page: 3, pageSize: 50, limit: 50, offset: 100 });
  assert.equal(parsePage({ size: '100000' }).pageSize, 25, 'an arbitrary size would be an unbounded query');
  assert.equal(parsePage({ page: '-4' }).page, 1);
  assert.equal(parsePage({ page: ['2', '9'] }).page, 2, 'a repeated param takes its first value');
  assert.ok(PAGE_SIZES.every((size) => size <= 100));
});

test('totalPages never reports zero pages', () => {
  assert.equal(totalPages(0, 25), 1);
  assert.equal(totalPages(30000, 25), 1200);
});

test('changing a filter resets the page; changing the page keeps the filters', () => {
  const current = { q: 'gombe', status: 'PENDING', page: 9 };
  assert.equal(buildHref('/admin/viewings', current, { status: 'CONFIRMED' }), '/admin/viewings?q=gombe&status=CONFIRMED');
  assert.equal(buildHref('/admin/viewings', current, { page: 10 }), '/admin/viewings?q=gombe&status=PENDING&page=10');
});

test('a cleared filter leaves the URL instead of lingering as an empty param', () => {
  assert.equal(buildHref('/admin/customers', { q: 'x', status: 'locked' }, { q: '' }), '/admin/customers?status=locked');
  assert.equal(buildHref('/admin/customers', { page: 2 }, { page: 1 }), '/admin/customers');
});

test('pageWindow keeps a 30k-row table to a handful of buttons', () => {
  assert.deepEqual(pageWindow(600, 1200), [1, null, 598, 599, 600, 601, 602, null, 1200]);
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
});

test('a date filter is a Kinshasa calendar day (UTC+1), with an exclusive end', () => {
  assert.equal(kinshasaDayStart('2026-09-13'), '2026-09-12T23:00:00.000Z');
  assert.equal(kinshasaDayEnd('2026-09-13'), '2026-09-13T23:00:00.000Z');
  assert.equal(kinshasaDayStart('13/09/2026'), undefined);
});
