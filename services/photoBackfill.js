/**
 * services/photoBackfill.js
 *
 * Runs services/photoEnhance.js over photos already published, so listings
 * sent before the correction existed look the same as new ones.
 * CLI: scripts/backfill-photo-enhance.js (dry run by default).
 *
 * - Only photos in our own bucket. Legacy/Laravel hosts and the
 *   noimage.jpg placeholder are left alone; so is an object already at the
 *   CURRENT version (`_<ENHANCE_VERSION>.jpg`).
 * - Always from the ORIGINAL. A URL at an older version (`_e2.jpg`) is
 *   resolved to the untouched object it was made from — same folder, same
 *   name without the suffix, any extension — and that is what gets
 *   corrected, never the older correction (no double processing). No
 *   original found → the URL is kept and counted as `noOriginal`. When the
 *   current correction leaves the original as it is, the listing goes back
 *   to the original.
 * - With `warm`, every new URL is pre-resized by the storefront's image
 *   optimiser (services/imageCacheWarm.js) BEFORE its listing is switched,
 *   so no visitor ever waits on a first resize. A URL the optimiser refuses
 *   leaves that listing unswitched.
 * - The corrected photo is uploaded under a NEW name
 *   (`enhancedObjectName`) and the original object is never deleted or
 *   overwritten: next/image caches a URL for 30 days, and the original is
 *   the rollback. For a `whatsapp_<hash>` object the new name is exactly
 *   what uploadListingPhotos now produces, so a later re-sync lands on it.
 * - One transaction per property rewrites `featured_image` and
 *   `property_slider_images.image` from old URL to new URL; each UPDATE
 *   matches the old URL, so a row changed in the meantime is not touched.
 *   `SET LOCAL` only — a bare SET leaks through the Supabase pooler.
 * - A photo that needs no correction, or fails, keeps its URL.
 *
 * Dependencies are injected (pool, storage, enhance) so
 * scripts/verify-pipeline.js can run it against fakes.
 */

const {
  ENHANCE_VERSION,
  enhanceImageBuffer,
  enhancedObjectName,
  isEnhancedObjectName,
  isEnhanceableExtension,
} = require('./photoEnhance');

/** True for an object this version produced. */
function isCurrentVersionName(objectPath) {
  return String(objectPath).toLowerCase().endsWith(`_${ENHANCE_VERSION}.jpg`);
}

/**
 * The untouched object an `_eN.jpg` was made from: same folder, same name
 * without the suffix, any enhanceable extension. `listings` caches one
 * storage.list() per folder. Resolves null when there is none.
 */
async function findOriginalObject(storage, enhancedPath, listings = new Map()) {
  const base = String(enhancedPath).replace(/_e\d+\.jpg$/i, '');
  const slash = base.lastIndexOf('/');
  const folder = slash >= 0 ? base.slice(0, slash) : '';
  const stem = base.slice(slash + 1);
  if (!listings.has(folder)) {
    const { data, error } = await storage.list(folder, { limit: 1000 });
    listings.set(folder, error ? [] : (data || []).map((o) => o.name));
  }
  const match = listings
    .get(folder)
    .find(
      (name) =>
        !isEnhancedObjectName(name) &&
        name.slice(0, name.lastIndexOf('.')) === stem &&
        isEnhanceableExtension(extensionOf(name)),
    );
  if (!match) return null;
  return folder ? `${folder}/${match}` : match;
}

/** Public URL of another object in the same folder as `url`. */
function siblingUrl(url, objectPath) {
  return url.replace(/[^/]+$/, encodeURIComponent(objectPath.split('/').pop()));
}

/** Public URL -> object path inside `bucket`, or null when it is not ours. */
function objectPathFromUrl(url, { supabaseUrl, bucket }) {
  if (!url || !supabaseUrl) return null;
  let parsed;
  let base;
  try {
    parsed = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (parsed.host !== base.host) return null;
  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(parsed.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function extensionOf(objectPath) {
  const match = /\.([^./]+)$/.exec(objectPath);
  return match ? match[1].toLowerCase() : '';
}

/** Every photo URL on every property, grouped by property. */
async function loadPropertyPhotos(pool, { propertyId = null, limit = null } = {}) {
  const params = [];
  let where = '';
  if (propertyId) {
    params.push(propertyId);
    where = `WHERE p.id = $${params.length}`;
  }
  let limitSql = '';
  if (limit) {
    params.push(limit);
    limitSql = `LIMIT $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.featured_image,
            COALESCE((SELECT array_agg(DISTINCT s.image) FROM property_slider_images s
                       WHERE s.property_id = p.id), '{}') AS slider
       FROM properties p
       ${where}
      ORDER BY p.id
      ${limitSql}`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    urls: [...new Set([row.featured_image, ...(row.slider || [])].filter(Boolean))],
  }));
}

async function applyUrlChanges(pool, propertyId, changes) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    for (const { oldUrl, newUrl } of changes) {
      await client.query(
        'UPDATE properties SET featured_image = $1, updated_at = NOW() WHERE id = $2 AND featured_image = $3',
        [newUrl, propertyId, oldUrl],
      );
      await client.query(
        'UPDATE property_slider_images SET image = $1, updated_at = NOW() WHERE property_id = $2 AND image = $3',
        [newUrl, propertyId, oldUrl],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {object} deps.storage   a Supabase `storage.from(bucket)` handle
 * @param {string} deps.supabaseUrl
 * @param {string} deps.bucket
 * @param {Function} [deps.enhance]  defaults to enhanceImageBuffer(buffer, enhanceOptions)
 * @param {object} [deps.enhanceOptions]  e.g. { lightnessTarget } for a preview at another strength
 * @param {Function} [deps.warm]  async (urls) => tally; a listing's new URLs, before it is switched
 * @param {boolean} [deps.write]
 * @param {number|null} [deps.propertyId]
 * @param {number|null} [deps.limit]   number of properties
 * @param {Function} [deps.log]
 * @param {Function} [deps.onSample]  (originalPath, original, after, { currentPath }) for dry-run previews
 * @returns {Promise<{ tally: object, changes: Array<{propertyId, oldUrl, newUrl}> }>}
 */
async function backfillPhotoEnhancement({
  pool,
  storage,
  supabaseUrl,
  bucket,
  enhanceOptions = {},
  enhance = (buffer) => enhanceImageBuffer(buffer, enhanceOptions),
  warm = null,
  write = false,
  propertyId = null,
  limit = null,
  log = console.log,
  onSample = null,
}) {
  const tally = {
    properties: 0,
    photos: 0,
    enhanced: 0,
    alreadyFine: 0,
    alreadyCurrent: 0,
    noOriginal: 0,
    foreign: 0,
    failed: 0,
    notSwitched: 0,
  };
  const changes = [];
  // ORIGINAL path -> new public URL (or null), so a photo shared by two listings is processed once.
  const done = new Map();
  const listings = new Map();

  const properties = await loadPropertyPhotos(pool, { propertyId, limit });
  for (const property of properties) {
    tally.properties += 1;
    const propertyChanges = [];

    for (const url of property.urls) {
      tally.photos += 1;
      const objectPath = objectPathFromUrl(url, { supabaseUrl, bucket });
      if (!objectPath) {
        tally.foreign += 1;
        continue;
      }
      if (isCurrentVersionName(objectPath)) {
        tally.alreadyCurrent += 1;
        continue;
      }

      let originalPath = objectPath;
      try {
        if (isEnhancedObjectName(objectPath)) originalPath = await findOriginalObject(storage, objectPath, listings);
      } catch (err) {
        originalPath = null;
        log(`#${property.id}: ${objectPath} — original lookup failed: ${err.message}`);
      }
      if (!originalPath) {
        tally.noOriginal += 1;
        continue;
      }
      if (!isEnhanceableExtension(extensionOf(originalPath))) {
        tally.foreign += 1;
        continue;
      }
      if (done.has(originalPath)) {
        const newUrl = done.get(originalPath);
        if (newUrl && newUrl !== url) propertyChanges.push({ propertyId: property.id, oldUrl: url, newUrl });
        continue;
      }

      try {
        const { data, error } = await storage.download(originalPath);
        if (error || !data) throw new Error(error?.message || 'empty download');
        const original = Buffer.from(await data.arrayBuffer());
        const result = await enhance(original);
        if (!result.enhanced) {
          // Needs nothing now: the listing shows the untouched original.
          tally.alreadyFine += 1;
          const originalUrl = siblingUrl(url, originalPath);
          done.set(originalPath, originalUrl);
          if (originalUrl !== url) propertyChanges.push({ propertyId: property.id, oldUrl: url, newUrl: originalUrl });
          continue;
        }

        const newPath = enhancedObjectName(originalPath);
        if (onSample) await onSample(originalPath, original, result.buffer, { currentPath: objectPath });
        let newUrl = null;
        if (write) {
          const { error: uploadError } = await storage.upload(newPath, result.buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
          if (uploadError) throw new Error(`upload ${newPath}: ${uploadError.message}`);
          newUrl = storage.getPublicUrl(newPath)?.data?.publicUrl || null;
          if (!newUrl) throw new Error(`no public URL for ${newPath}`);
        } else {
          newUrl = siblingUrl(url, newPath);
        }
        tally.enhanced += 1;
        done.set(originalPath, newUrl);
        propertyChanges.push({ propertyId: property.id, oldUrl: url, newUrl });
      } catch (err) {
        tally.failed += 1;
        done.set(originalPath, null);
        log(`#${property.id}: ${originalPath} left as-is — ${err.message}`);
      }
    }

    if (propertyChanges.length === 0) continue;
    if (write) {
      if (warm) {
        // Resize before switching: the first visitor must not pay for it.
        const warmed = await warm([...new Set(propertyChanges.map((c) => c.newUrl))]);
        const refused = Object.keys(warmed || {}).filter((k) => k.startsWith('http') || k === 'err');
        if (refused.length) {
          tally.notSwitched += 1;
          log(`#${property.id}: NOT switched — the image optimiser refused a new URL (${JSON.stringify(warmed)})`);
          continue;
        }
      }
      try {
        await applyUrlChanges(pool, property.id, propertyChanges);
      } catch (err) {
        log(`#${property.id}: URLs NOT updated — ${err.message}`);
        continue;
      }
    }
    changes.push(...propertyChanges);
    log(`#${property.id}: ${propertyChanges.length} photo(s) ${write ? 'updated' : 'would be updated'}`);
  }

  return { tally, changes };
}

/** Puts every URL in a rollback map back. The corrected objects stay in the bucket. */
async function rollbackPhotoEnhancement({ pool, changes, log = console.log }) {
  const byProperty = new Map();
  for (const change of changes) {
    if (!byProperty.has(change.propertyId)) byProperty.set(change.propertyId, []);
    byProperty.get(change.propertyId).push({ oldUrl: change.newUrl, newUrl: change.oldUrl });
  }
  let restored = 0;
  for (const [propertyId, swaps] of byProperty) {
    await applyUrlChanges(pool, propertyId, swaps);
    restored += swaps.length;
    log(`#${propertyId}: ${swaps.length} photo(s) restored`);
  }
  return { restored };
}

module.exports = {
  objectPathFromUrl,
  isCurrentVersionName,
  findOriginalObject,
  loadPropertyPhotos,
  backfillPhotoEnhancement,
  rollbackPhotoEnhancement,
};
