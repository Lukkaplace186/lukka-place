// Runs after `npm install` (postinstall) and before `next start` (prestart).
// Patches Next's image optimizer so photos are served right after a restart.
//
// Why (2026-11-27): Next 16.3 tracks the image disk cache in an LRU that it
// fills at startup by opening EVERY cached image in full, only to learn its
// size (`initCacheEntries`), and every image read — a cache hit included —
// waits for that fill (`await this.cacheDiskLRU` in `get`). With ~198,000
// entries (6.8 GB, /var/data/next-image-cache) the fill took ~8 minutes, and
// for those minutes after every deploy no photo that phones or Cloudflare did
// not already hold could load (measured live: 15:00:30 restart, first photo
// served 15:08). Two changes, nothing else:
//
// 1. The fill reads each entry's size with stat() instead of reading the file,
//    64 entries at a time: ~9 s for the same cache, measured on the VPS.
//    Zero-byte entries are skipped (an LRU entry of size 0 throws — the
//    reason prune-empty-image-cache.mjs exists).
// 2. A cache hit no longer waits for the fill: the hit's "recently used" mark
//    is sent to the LRU when it is ready. Writes still wait, so eviction
//    accounting is unchanged.
//
// `images.maximumDiskCacheSize: 0` is not an alternative: it turns the disk
// cache off, so every photo would be resized on every request.
//
// Idempotent (a marker comment), and harmless when Next changes: if the exact
// code is not found, the file is left alone and a warning says so. Never
// fails the install or the start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '/* lukka-patch:image-cache-startup */';
export const SCAN_BATCH = 64;

const SCAN_LOOP = `    for (const cacheKey of cacheKeys){
        try {
            const { expireAt, buffer } = await readFromCacheDir(cacheDir, cacheKey);
            entries.push({
                key: cacheKey,
                size: buffer.byteLength,
                expireAt
            });
        } catch  {
        // Skip entries that can't be read from disk
        }
    }`;

const HIT_WAIT = `            const lru = await this.cacheDiskLRU;
            lru == null ? void 0 : lru.get(cacheKey);`;

// `fs`/`path` are bound differently in the two builds of the same file.
const NAMES = {
  cjs: { readdir: '_fs.promises.readdir', stat: '_fs.promises.stat', join: '(0, _path.join)' },
  esm: { readdir: 'promises.readdir', stat: 'promises.stat', join: 'join' },
};

function scanLoop({ readdir, stat, join }) {
  return `    ${MARKER}
    // Size from stat(), ${SCAN_BATCH} entries at a time (see web/scripts/patch-next-image-cache.mjs).
    const readEntry = async (cacheKey)=>{
        try {
            const dir = ${join}(cacheDir, cacheKey);
            const file = (await ${readdir}(dir))[0];
            if (!file) return;
            const { size } = await ${stat}(${join}(dir, file));
            if (size > 0) entries.push({
                key: cacheKey,
                size,
                expireAt: Number(file.split('.', 5)[1])
            });
        } catch  {
        // Skip entries that can't be read from disk
        }
    };
    for(let i = 0; i < cacheKeys.length; i += ${SCAN_BATCH}){
        await Promise.all(cacheKeys.slice(i, i + ${SCAN_BATCH}).map(readEntry));
    }`;
}

const HIT_NO_WAIT = `            ${MARKER}
            this.cacheDiskLRU.then((lru)=>lru == null ? void 0 : lru.get(cacheKey)).catch(()=>{});`;

/**
 * @param {string} source image-optimizer.js
 * @param {'cjs'|'esm'} flavour
 * @returns {{ source: string, status: 'patched'|'already'|'not-found', missing: string[] }}
 */
export function patchImageOptimizerSource(source, flavour) {
  if (source.includes(MARKER)) return { source, status: 'already', missing: [] };
  const missing = [];
  if (!source.includes(SCAN_LOOP)) missing.push('initCacheEntries loop');
  if (!source.includes(HIT_WAIT)) missing.push('get() LRU wait');
  if (missing.length) return { source, status: 'not-found', missing };
  const patched = source.replace(SCAN_LOOP, scanLoop(NAMES[flavour])).replace(HIT_WAIT, HIT_NO_WAIT);
  return { source: patched, status: 'patched', missing: [] };
}

export function patchNextImageCache(webRoot) {
  const results = [];
  for (const [flavour, rel] of [
    ['cjs', 'node_modules/next/dist/server/image-optimizer.js'],
    ['esm', 'node_modules/next/dist/esm/server/image-optimizer.js'],
  ]) {
    const file = path.join(webRoot, rel);
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      results.push({ file: rel, status: 'absent', missing: [] });
      continue;
    }
    const out = patchImageOptimizerSource(source, flavour);
    if (out.status === 'patched') fs.writeFileSync(file, out.source);
    results.push({ file: rel, status: out.status, missing: out.missing });
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    for (const r of patchNextImageCache(webRoot)) {
      if (r.status === 'not-found') {
        console.warn(`[patch-next-image-cache] ${r.file}: code not found (${r.missing.join(', ')}) — Next changed; left as is, photos may stall after restarts again`);
      } else if (r.status !== 'absent') {
        console.log(`[patch-next-image-cache] ${r.file}: ${r.status}`);
      }
    }
  } catch (err) {
    console.error('[patch-next-image-cache] skipped:', err.message);
  }
}
