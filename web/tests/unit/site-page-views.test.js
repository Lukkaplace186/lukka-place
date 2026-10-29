import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calls, normalizeSql, reset } from '../support/fakePool.js';
import { sitePageViewPath } from '@/lib/analyticsClient';
import { getConversionByDevice } from '@/lib/analytics';

// Every public page records a view since 2026-10-29; only /listings/:id did before.

test('every public page is a view, except a listing page (ListingViewTracker sends that one)', () => {
  assert.equal(sitePageViewPath('/'), '/');
  assert.equal(sitePageViewPath('/listings'), '/listings');
  assert.equal(sitePageViewPath('/agents/12'), '/agents/12');
  assert.equal(sitePageViewPath('/location/limete'), '/location/limete');
  assert.equal(sitePageViewPath('/listings/310'), null, 'counted once, by the listing tracker');
});

test('a filter change is not a new page: the query string is dropped', () => {
  assert.equal(sitePageViewPath('/listings?commune=Limete&view=map'), '/listings');
  assert.equal(sitePageViewPath('/listings/310?utm_source=wa_status'), null);
});

test('nothing odd is sent as a path', () => {
  for (const bad of [null, undefined, '', 'listings', `/${'a'.repeat(300)}`]) {
    assert.equal(sitePageViewPath(bad), null, String(bad).slice(0, 20));
  }
});

test('both public layouts mount the tracker', () => {
  for (const file of ['app/(site)/layout.js', 'app/(portfolio)/layout.js']) {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(src, /<SitePageViewTracker \/>/, file);
  }
});

test('WhatsApp conversion by device divides by listing views only, not every page', async () => {
  reset();
  await getConversionByDevice({ sinceDays: 30 });
  const viewsCte = normalizeSql(calls[0].text).split(' c AS (')[0];
  assert.match(viewsCte, /FROM page_views WHERE path LIKE '\/listings\/%'/);
});
