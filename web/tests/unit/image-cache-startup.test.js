// Photos right after a restart (2026-11-27): Next's image-cache LRU was
// filled by reading every cached image in full (~8 min for ~198k entries),
// and every image request waited for it. scripts/patch-next-image-cache.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MARKER, patchImageOptimizerSource } from '../../scripts/patch-next-image-cache.mjs';
import { pruneEmptyImageCache } from '../../scripts/prune-empty-image-cache.mjs';

const root = process.cwd();
const nextFile = (rel) => path.join(root, 'node_modules/next/dist', rel, 'image-optimizer.js');
// The installed copy is patched once postinstall has run, unpatched before:
// either way, patching what is there must give the patched text.
const read = (rel) => fs.readFileSync(nextFile(rel), 'utf8');

for (const [flavour, rel] of [['cjs', 'server'], ['esm', 'esm/server']]) {
  test(`the installed Next (${flavour}) is patched or patchable, and the patch is idempotent`, () => {
    const out = patchImageOptimizerSource(read(rel), flavour);
    assert.notEqual(out.status, 'not-found', `Next changed: ${out.missing.join(', ')} — re-check the startup scan before upgrading`);
    const patched = out.source;
    assert.ok(patched.includes(MARKER));
    assert.doesNotMatch(patched, /const \{ expireAt, buffer \} = await readFromCacheDir\(cacheDir, cacheKey\);/, 'startup no longer reads whole images');
    // A cache hit does not wait for the fill; a write still does (eviction).
    assert.equal(patched.match(/await this\.cacheDiskLRU/g)?.length, 1);
    assert.match(patched, /this\.cacheDiskLRU\.then\(\(lru\)=>lru == null \? void 0 : lru\.get\(cacheKey\)\)\.catch\(\(\)=>\{\}\);/);
    assert.equal(patchImageOptimizerSource(patched, flavour).status, 'already');
  });
}

test('an unknown Next leaves the file untouched', () => {
  const out = patchImageOptimizerSource('async function initCacheEntries(cacheDir) {}', 'cjs');
  assert.equal(out.status, 'not-found');
  assert.equal(out.source, 'async function initCacheEntries(cacheDir) {}');
});

function cacheFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-cache-'));
  const entry = (key, file, bytes) => {
    fs.mkdirSync(path.join(dir, key));
    if (file) fs.writeFileSync(path.join(dir, key, file), Buffer.alloc(bytes, 1));
  };
  entry('late', '2592000.3000.etag.up.webp', 30);
  entry('early', '2592000.1000.etag.up.webp', 10);
  entry('mid', '2592000.2000.etag.up.webp', 20);
  entry('empty-file', '2592000.1500.etag.up.webp', 0);
  entry('empty-dir', null, 0);
  return dir;
}

test('the patched startup scan gives the same entries, sizes from stat, oldest first, no empty ones', async () => {
  const patched = patchImageOptimizerSource(read('server'), 'cjs').source;
  const start = patched.indexOf('async function initCacheEntries(cacheDir) {');
  const end = patched.indexOf('\n}\n', start) + 2;
  const initCacheEntries = new Function('_fs', '_path', `${patched.slice(start, end)}\nreturn initCacheEntries;`)(fs, path);
  const dir = cacheFixture();
  try {
    const entries = await initCacheEntries(dir);
    assert.deepEqual(entries, [
      { key: 'early', size: 10, expireAt: 1000 },
      { key: 'mid', size: 20, expireAt: 2000 },
      { key: 'late', size: 30, expireAt: 3000 },
    ]);
    assert.deepEqual(await initCacheEntries(path.join(dir, 'missing')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the pre-start cleanup still removes only empty files, in batches', async () => {
  const dir = cacheFixture();
  try {
    const removed = await pruneEmptyImageCache(dir);
    assert.deepEqual(removed.map((f) => path.basename(path.dirname(f))), ['empty-file']);
    assert.ok(fs.existsSync(path.join(dir, 'late', '2592000.3000.etag.up.webp')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('npm runs the patch after install and before every start', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.postinstall, 'node scripts/patch-next-image-cache.mjs');
  assert.equal(pkg.scripts.prestart, 'node scripts/patch-next-image-cache.mjs && node scripts/prune-empty-image-cache.mjs');
});
