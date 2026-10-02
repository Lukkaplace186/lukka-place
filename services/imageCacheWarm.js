/**
 * services/imageCacheWarm.js
 *
 * Asks the storefront's image optimiser (next/image) for a photo at every
 * width it can emit, so the resized copies exist before any visitor flips to
 * the photo. A first resize costs ~600 ms; a cached one ~100 ms. Used by
 * scripts/warm-image-cache.js (every listing photo) and by
 * services/photoBackfill.js (each new URL, BEFORE the listing is switched to
 * it). On production the variants land in /var/data/next-image-cache
 * (web/CLAUDE.md, "Deployment").
 */

/** Next 16 defaults: imageSizes + deviceSizes (web/next.config.mjs overrides neither). */
const WARM_WIDTHS = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const DEFAULT_WEB_ORIGIN = 'http://127.0.0.1:3002';
const ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/** One variant. Resolves 'HIT' | 'MISS' | 'STALE' | 'other' | 'http<status>' | 'err'. */
async function warmVariant(url, width, { origin = DEFAULT_WEB_ORIGIN, fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`${origin}/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`, {
      headers: { accept: ACCEPT },
    });
    await r.arrayBuffer();
    return r.ok ? r.headers.get('x-nextjs-cache') || 'other' : `http${r.status}`;
  } catch {
    return 'err';
  }
}

/**
 * Every width of every URL, `concurrency` at a time (2 keeps the web process
 * responsive on the VPS). Resolves a tally of outcomes.
 */
async function warmUrls(urls, { origin = DEFAULT_WEB_ORIGIN, widths = WARM_WIDTHS, concurrency = 2, fetchImpl = fetch, onProgress = null } = {}) {
  const jobs = [];
  for (const url of urls) for (const width of widths) jobs.push([url, width]);
  const tally = {};
  let done = 0;
  async function worker() {
    while (jobs.length) {
      const [url, width] = jobs.shift();
      const outcome = await warmVariant(url, width, { origin, fetchImpl });
      tally[outcome] = (tally[outcome] || 0) + 1;
      done += 1;
      if (onProgress) onProgress(done, tally);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return tally;
}

module.exports = { WARM_WIDTHS, DEFAULT_WEB_ORIGIN, warmVariant, warmUrls };
