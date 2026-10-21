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
const { enhanceImageBuffer, enhancedObjectName, isEnhanceableExtension } = require('./photoEnhance');

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
      // The name hashes the ORIGINAL bytes, so a re-sync lands on the same
      // object; a corrected photo gets the versioned _eN.jpg name
      // (services/photoEnhance.js), never the original's. The local file in
      // UPLOADS_DIR is not touched — the original is always kept.
      const originalPath = `properties/${propertyId}/whatsapp_${contentHash(buffer)}.${ext}`;
      let body = buffer;
      let storagePath = originalPath;
      let uploadExt = ext;
      if (isEnhanceableExtension(ext)) {
        const result = await enhanceImageBuffer(buffer);
        if (result.enhanced) {
          body = result.buffer;
          storagePath = enhancedObjectName(originalPath);
          uploadExt = 'jpg';
        }
      }

      const { error: uploadError } = await storage.upload(storagePath, body, {
        contentType: CONTENT_TYPE_BY_EXT[uploadExt] || 'application/octet-stream',
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

/**
 * Upload a listing's videos (services/listingMedia.js) and, where ffmpeg can
 * cut one, a JPEG cover frame for each. Same naming rule as photos — the
 * object name hashes the file's bytes, so a re-sync reuses the same object.
 * No enhancement: a video is published as the agent filmed it.
 *
 * @param {string[]} localWebPaths  Entries from listings.videos (SQLite).
 * @param {number} propertyId
 * @returns {Promise<Array<{url: string, poster: string|null}>>} In input order;
 *          a failed upload is omitted.
 */
async function uploadListingVideos(localWebPaths, propertyId) {
  if (!isConfigured() || !Array.isArray(localWebPaths) || localWebPaths.length === 0 || !propertyId) {
    return [];
  }
  const { posterForVideo, VIDEO_CONTENT_TYPE_BY_EXT } = require('./listingMedia');
  const storage = getClient().storage.from(BUCKET);
  const out = [];
  // One at a time: each video is up to 16 MB in memory.
  for (const webPath of localWebPaths) {
    const localPath = resolveLocalPath(webPath);
    let buffer;
    try {
      buffer = fs.readFileSync(localPath);
    } catch (err) {
      console.warn(`[supabaseStorage] could not read ${localPath}: ${err.message}`);
      continue;
    }
    const ext = path.extname(localPath).slice(1).toLowerCase() || 'mp4';
    const base = `properties/${propertyId}/whatsapp_${contentHash(buffer)}`;
    const { error } = await storage.upload(`${base}.${ext}`, buffer, {
      contentType: VIDEO_CONTENT_TYPE_BY_EXT[ext] || 'video/mp4',
      upsert: true,
    });
    if (error) {
      console.warn(`[supabaseStorage] video upload failed for ${base}.${ext}: ${error.message}`);
      continue;
    }
    const url = storage.getPublicUrl(`${base}.${ext}`).data?.publicUrl || null;
    if (!url) continue;

    let poster = null;
    const posterPath = await posterForVideo(localPath);
    if (posterPath) {
      const { error: posterError } = await storage.upload(`${base}_poster.jpg`, fs.readFileSync(posterPath), {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (posterError) console.warn(`[supabaseStorage] cover upload failed for ${base}: ${posterError.message}`);
      else poster = storage.getPublicUrl(`${base}_poster.jpg`).data?.publicUrl || null;
    }
    out.push({ url, poster });
  }
  return out;
}

module.exports = {
  uploadListingPhotos,
  uploadListingVideos,
  isConfigured,
  getClient,
  resolveLocalPath,
  BUCKET,
};
