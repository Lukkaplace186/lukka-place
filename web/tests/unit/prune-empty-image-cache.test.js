// One empty file in next/image's disk cache disabled the whole cache for six
// days (Next 16's LRU refuses a 0-byte entry and keeps the failure).
// scripts/prune-empty-image-cache.mjs runs before `next start`; this pins
// that it removes only empty files and is wired as npm's prestart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneEmptyImageCache } from '../../scripts/prune-empty-image-cache.mjs';

test('removes empty cache files and keeps real ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-cache-'));
  fs.mkdirSync(path.join(dir, 'keyA'));
  fs.mkdirSync(path.join(dir, 'keyB'));
  const empty = path.join(dir, 'keyA', '2592000.1.etag.webp');
  const real = path.join(dir, 'keyB', '2592000.1.etag.webp');
  fs.writeFileSync(empty, '');
  fs.writeFileSync(real, 'RIFF....WEBP');

  const removed = await pruneEmptyImageCache(dir);

  assert.deepEqual(removed, [empty]);
  assert.equal(fs.existsSync(empty), false);
  assert.equal(fs.existsSync(real), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing cache directory is not an error', async () => {
  assert.deepEqual(await pruneEmptyImageCache(path.join(os.tmpdir(), 'no-such-cache-dir-xyz')), []);
});

test('runs before next start', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.prestart, 'node scripts/prune-empty-image-cache.mjs');
});
