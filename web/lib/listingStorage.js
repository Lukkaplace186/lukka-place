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
