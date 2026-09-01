import 'server-only';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Storage client for agent avatars — first supabase-js usage in
 * web/ (everything else here talks to Postgres via lib/db.js's pg Pool).
 * Mirrors services/supabaseStorage.js's proven pattern (engine repo, listing
 * photos) but in its own bucket (SUPABASE_AVATARS_BUCKET), keeping
 * agent-identity objects in a separate lifecycle domain from listing photos.
 */

const BUCKET = process.env.SUPABASE_AVATARS_BUCKET || 'avatars';

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
 * Uploads one agent's avatar. The filename is content-hashed, so re-uploading
 * the same bytes (e.g. a resubmitted form) reuses the same object instead of
 * accumulating orphaned files under agents/{agentId}/.
 *
 * @param {Buffer} buffer
 * @param {number} agentId
 * @param {'jpg'|'jpeg'|'png'|'webp'} ext
 * @returns {Promise<string>} public URL
 */
export async function uploadAgentAvatar(buffer, agentId, ext) {
  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 13);
  const storagePath = `agents/${agentId}/avatar_${hash}.${ext}`;
  const storage = getClient().storage.from(BUCKET);

  const { error } = await storage.upload(storagePath, buffer, {
    contentType: CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`Avatar upload failed: ${error.message}`);

  const { data } = storage.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error('Avatar upload succeeded but no public URL was returned');
  return data.publicUrl;
}
