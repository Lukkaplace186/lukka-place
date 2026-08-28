/**
 * services/supabaseStorage.js
 *
 * Uploads listing photos (already downloaded locally by
 * services/mediaStorage.js) to the Supabase Storage bucket the live website
 * actually serves images from, so featured_image / property_slider_images
 * can point at real, publicly viewable URLs instead of the noimage.jpg
 * placeholder.
 *
 * Path convention (properties/{property_id}/whatsapp_<hash>.<ext>) matches
 * what the site's earlier WhatsApp bot already wrote — see services/postgres.js
 * doc comment. The hash is of the file's own bytes, not random: re-uploading
 * the same photo (e.g. on a re-sync after a correction) reuses the same
 * object instead of accumulating duplicates.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { UPLOADS_ROOT } = require('./mediaStorage');

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Property_images';

const CONTENT_TYPE_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let client = null;
function getClient() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/** '/uploads/listings/foo.jpg' -> the real local file path it was written to. */
function resolveLocalPath(webPath) {
  return path.join(UPLOADS_ROOT, String(webPath).replace(/^\/?uploads\//, ''));
}

function contentHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 13);
}

/**
 * Upload every local photo for one listing to Supabase Storage.
 *
 * Best-effort per file: one failed upload is logged and skipped rather than
 * aborting the rest — a partial gallery beats none at all.
 *
 * @param {string[]} localWebPaths  Entries from listings.photos (SQLite), e.g.
 *        '/uploads/listings/wamid_ABC-0.jpg'.
 * @param {number} propertyId       The Postgres properties.id these belong to —
 *        part of the storage path, so this must run after the property row exists.
 * @returns {Promise<string[]>} Public URLs, in the same order as the input
 *          (failed uploads are simply omitted).
 */
async function uploadListingPhotos(localWebPaths, propertyId) {
  if (!isConfigured()) {
    console.log('[supabaseStorage] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — skipping upload');
    return [];
  }
  if (!Array.isArray(localWebPaths) || localWebPaths.length === 0 || !propertyId) {
    return [];
  }

  const storage = getClient().storage.from(BUCKET);

  // Each path's own try/catch already logs-and-skips on failure rather than
  // throwing, so running the uploads concurrently (instead of the previous
  // sequential for-await loop) is safe and cuts real wall-clock time for a
  // multi-photo listing.
  const urls = await Promise.all(
    localWebPaths.map(async (webPath) => {
      const localPath = resolveLocalPath(webPath);
      let buffer;
      try {
        buffer = fs.readFileSync(localPath);
      } catch (err) {
        console.warn(`[supabaseStorage] could not read ${localPath}: ${err.message}`);
        return null;
      }

      const ext = path.extname(localPath).slice(1).toLowerCase() || 'jpg';
      const storagePath = `properties/${propertyId}/whatsapp_${contentHash(buffer)}.${ext}`;

      const { error: uploadError } = await storage.upload(storagePath, buffer, {
        contentType: CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream',
        upsert: true,
      });
      if (uploadError) {
        console.warn(`[supabaseStorage] upload failed for ${storagePath}: ${uploadError.message}`);
        return null;
      }

      const { data } = storage.getPublicUrl(storagePath);
      return data?.publicUrl || null;
    }),
  );

  return urls.filter(Boolean);
}

module.exports = {
  uploadListingPhotos,
  isConfigured,
  resolveLocalPath,
  BUCKET,
};
