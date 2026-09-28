/**
 * services/photoBackfill.js
 *
 * Runs services/photoEnhance.js over photos already published, so listings
 * sent before the correction existed look the same as new ones.
 * CLI: scripts/backfill-photo-enhance.js (dry run by default).
 *
 * - Only photos in our own bucket. Legacy/Laravel hosts and the
 *   noimage.jpg placeholder are left alone; so is an object already
 *   carrying an `_eN.jpg` name.
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
  enhanceImageBuffer,
  enhancedObjectName,
  isEnhancedObjectName,
  isEnhanceableExtension,
} = require('./photoEnhance');

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
 * @param {Function} [deps.enhance]  defaults to enhanceImageBuffer
 * @param {boolean} [deps.write]
 * @param {number|null} [deps.propertyId]
 * @param {number|null} [deps.limit]   number of properties
 * @param {Function} [deps.log]
 * @param {Function} [deps.onSample]  (objectPath, before, after) for dry-run previews
 * @returns {Promise<{ tally: object, changes: Array<{propertyId, oldUrl, newUrl}> }>}
 */
async function backfillPhotoEnhancement({
  pool,
  storage,
  supabaseUrl,
  bucket,
  enhance = enhanceImageBuffer,
  write = false,
  propertyId = null,
  limit = null,
  log = console.log,
  onSample = null,
}) {
  const tally = { properties: 0, photos: 0, enhanced: 0, alreadyFine: 0, alreadyEnhanced: 0, foreign: 0, failed: 0 };
  const changes = [];
  const done = new Map(); // object path -> new URL, so a photo shared by two listings is processed once

  const properties = await loadPropertyPhotos(pool, { propertyId, limit });
  for (const property of properties) {
    tally.properties += 1;
    const propertyChanges = [];

    for (const url of property.urls) {
      tally.photos += 1;
      const objectPath = objectPathFromUrl(url, { supabaseUrl, bucket });
      if (!objectPath || !isEnhanceableExtension(extensionOf(objectPath))) {
        tally.foreign += 1;
        continue;
      }
      if (isEnhancedObjectName(objectPath)) {
        tally.alreadyEnhanced += 1;
        continue;
      }
      if (done.has(objectPath)) {
        const newUrl = done.get(objectPath);
        if (newUrl) propertyChanges.push({ propertyId: property.id, oldUrl: url, newUrl });
        continue;
      }

      try {
        const { data, error } = await storage.download(objectPath);
        if (error || !data) throw new Error(error?.message || 'empty download');
        const original = Buffer.from(await data.arrayBuffer());
        const result = await enhance(original);
        if (!result.enhanced) {
          tally.alreadyFine += 1;
          done.set(objectPath, null);
          continue;
        }

        const newPath = enhancedObjectName(objectPath);
        if (onSample) await onSample(objectPath, original, result.buffer);
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
          newUrl = url.replace(/[^/]+$/, encodeURIComponent(newPath.split('/').pop()));
        }
        tally.enhanced += 1;
        done.set(objectPath, newUrl);
        propertyChanges.push({ propertyId: property.id, oldUrl: url, newUrl });
      } catch (err) {
        tally.failed += 1;
        done.set(objectPath, null);
        log(`#${property.id}: ${objectPath} left as-is — ${err.message}`);
      }
    }

    if (propertyChanges.length === 0) continue;
    if (write) {
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
  loadPropertyPhotos,
  backfillPhotoEnhancement,
  rollbackPhotoEnhancement,
};
