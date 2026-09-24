import 'server-only';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Storage client for manually-created listing photos — same
 * bucket (`Property_images`) and public-URL convention
 * services/supabaseStorage.js (engine repo) already uses for WhatsApp-sourced
 * photos, so a listing's gallery looks the same regardless of which path
 * created it. Filenames are prefixed `agent_` (vs. the engine's `whatsapp_`)
 * only to keep the two write paths' objects visually distinguishable in the
 * bucket — both live under the same `properties/{propertyId}/` path.
 */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'Property_images';

const CONTENT_TYPE_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

let client = null;
function getClient() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/**
 * A site image uploaded from /admin/cms (the homepage hero), under `cms/` in
 * the same public bucket. Content-hashed name, so a new upload is a new URL
 * and no CDN or browser cache can keep serving the previous picture.
 * @returns {Promise<string>} public URL
 */
export async function uploadCmsImage(buffer, ext, folder = 'hero') {
  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 16);
  const storagePath = `cms/${folder}/${hash}.${ext}`;
  const storage = getClient().storage.from(BUCKET);
  const { error } = await storage.upload(storagePath, buffer, {
    contentType: CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`CMS image upload failed: ${error.message}`);
  const { data } = storage.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error('CMS image upload succeeded but no public URL was returned');
  return data.publicUrl;
}

/**
 * @param {Buffer} buffer
 * @param {number} propertyId
 * @param {'jpg'|'jpeg'|'png'|'webp'} ext
 * @returns {Promise<string>} public URL
 */
export async function uploadListingPhoto(buffer, propertyId, ext) {
  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 13);
  const storagePath = `properties/${propertyId}/agent_${hash}.${ext}`;
  const storage = getClient().storage.from(BUCKET);

  const { error } = await storage.upload(storagePath, buffer, {
    contentType: CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`Listing photo upload failed: ${error.message}`);

  const { data } = storage.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error('Listing photo upload succeeded but no public URL was returned');
  return data.publicUrl;
}

/**
 * A /projets image (photo, render, plan, construction update), under
 * `projects/{id}/` in the same public bucket. Resized to 2000px JPEG when
 * sharp is available; content-hashed so a re-upload is a new URL.
 * @returns {Promise<string>} public URL
 */
export async function uploadProjectImage(buffer, projectId, ext) {
  let body = buffer;
  let finalExt = ext;
  try {
    const { default: sharp } = await import('sharp');
    body = await sharp(buffer).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    finalExt = 'jpg';
  } catch {
    // sharp unavailable: keep the original bytes.
  }
  const hash = crypto.createHash('md5').update(body).digest('hex').slice(0, 16);
  const storagePath = `projects/${projectId}/${hash}.${finalExt}`;
  const storage = getClient().storage.from(BUCKET);
  const { error } = await storage.upload(storagePath, body, {
    contentType: CONTENT_TYPE_BY_EXT[finalExt] || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`Project image upload failed: ${error.message}`);
  const { data } = storage.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error('Project image upload succeeded but no public URL was returned');
  return data.publicUrl;
}
