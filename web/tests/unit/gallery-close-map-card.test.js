import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two phone reports (2026-10-23): no visible way out of a playing video in
 * the gallery viewer, and map cards slow to show their photo on 4G.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

test('the viewer has its own close button, above the stage, and pauses on close', () => {
  const gallery = read('components/PhotoGallery.js');
  const viewer = gallery.slice(gallery.indexOf('<Dialog open={isOpen}'));
  assert.match(viewer, /showCloseButton=\{false\}/);
  assert.match(viewer, /<DialogClose asChild>/);
  assert.match(viewer, /aria-label=\{t\('listings\.gallery\.close'\)\}/);
  assert.match(viewer, /h-11 w-11/, 'a 44px target');
  assert.match(gallery, /videoRef\.current\?\.pause\(\)/);
  assert.match(viewer, /e\.target === e\.currentTarget\) closeLightbox\(\)/, 'a tap on the bare stage closes');
  assert.match(viewer, /dy > SWIPE_CLOSE_PX/, 'a swipe down closes');
  assert.doesNotMatch(viewer, /<video[\s\S]*?className="h-full w-full/, 'the video leaves stage around it');
});

test('both dictionaries name the close button', async () => {
  for (const locale of ['fr', 'en']) {
    const { default: dict } = await import(`@/lib/i18n/${locale}.json`, { with: { type: 'json' } });
    assert.ok(dict.listings.gallery.close, locale);
  }
});

let fetches;
beforeEach(() => {
  fetches = [];
  globalThis.fetch = async (url) => {
    const ids = new URL(url, 'http://x').searchParams.get('ids').split(',');
    fetches.push(ids);
    return { ok: true, json: async () => ({ data: ids.map((id) => ({ id: Number(id), featured_image: `https://x/${id}.jpg` })) }) };
  };
});

test('the map cache serves a remembered row without a fetch, and fetches the tapped card first', async () => {
  const { rememberListings, cachedListings, loadListings } = await import('@/lib/mapListingCache');
  rememberListings([{ id: 7, featured_image: 'https://x/7.jpg' }, { id: 8 }]);
  assert.deepEqual(cachedListings(['7', '8']).map((row) => row.id), [7], 'a marker without photos is not a card row');

  const ids = Array.from({ length: 45 }, (_, i) => String(100 + i));
  const batches = [];
  await loadListings(ids, { first: '140', onBatch: (rows) => batches.push(rows.length) });
  assert.ok(fetches[0].includes('140'), 'the tapped listing is in the first request');
  assert.ok(fetches[0].includes('138') && fetches[0].includes('142'), 'with its neighbours');
  assert.equal(fetches.length, 3);
  assert.deepEqual(batches, [20, 40, 45], 'cards draw after each batch, not only after the last');
});
