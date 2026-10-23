// Runs before `next start` (npm "prestart"; PM2 starts the site with
// `npm start`). Removes empty files from next/image's disk cache.
//
// Why (2026-10-23): Next 16 tracks the image cache's size in an LRU that it
// fills from disk on first use, and an entry of 0 bytes makes that fill throw
// ("LRUCache: calculateSize returned 0"). The failed fill is kept for the
// life of the process, so every image read and write fails after it: every
// photo was resized again on every request (X-Nextjs-Cache: MISS, ~1.2 s)
// from 2026-10-17 to 2026-10-23, because ONE .webp had been left empty —
// most likely a restart cutting a write short during a deploy. Next never
// writes an empty image itself, so an interrupted write is the only way in,
// and clearing them at start is enough.
//
// .next/cache/images is a symlink to /var/data/next-image-cache on the VPS;
// fs follows it. A missing cache directory is not an error.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function pruneEmptyImageCache(cacheDir) {
  let keys;
  try {
    keys = await fs.readdir(cacheDir);
  } catch {
    return [];
  }
  const removed = [];
  for (const key of keys) {
    const dir = path.join(cacheDir, key);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const stat = await fs.stat(full);
        if (stat.isFile() && stat.size === 0) {
          await fs.unlink(full);
          removed.push(full);
        }
      } catch {
        // A file another process removed meanwhile is not our concern.
      }
    }
  }
  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cacheDir = path.join(webRoot, '.next', 'cache', 'images');
  try {
    const removed = await pruneEmptyImageCache(cacheDir);
    if (removed.length) {
      console.log(`[prune-image-cache] removed ${removed.length} empty cache file(s):`);
      for (const f of removed) console.log(`  ${f}`);
    }
  } catch (err) {
    // Never block the site from starting over a cache tidy-up.
    console.error('[prune-image-cache] skipped:', err.message);
  }
}
