/**
 * Listing videos (2026-10-21). Agents send videos with their photos on
 * WhatsApp; the engine stores them in Supabase Storage and writes
 * `properties.videos` jsonb, `[{ url, poster }]` (engine services/listingMedia.js,
 * migrations/20261021_listing_videos.sql). A listing needs one photo OR one
 * video; with no photo, the first video's cover frame is its featured_image.
 *
 * Read as the plain column (VIDEOS_SQL); the migration has run everywhere
 * (web/CLAUDE.md, "Listing queries read columns, not to_jsonb(p)"). Pure and client-safe.
 */

/** The jsonb, or NULL. */
export const VIDEOS_SQL = `(p.videos)`;

/** How many videos, 0 for NULL / not an array. */
export const VIDEO_COUNT_SQL = `(CASE WHEN jsonb_typeof(p.videos) = 'array'
  THEN jsonb_array_length(p.videos) ELSE 0 END)`;

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * The listing's playable videos, in the agent's order. Anything that is not
 * an https URL is dropped rather than handed to a <video src>.
 *
 * @param {{videos?: unknown}} listing
 * @returns {Array<{url: string, poster: string|null}>}
 */
export function listingVideos(listing) {
  let raw = listing?.videos;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const url = httpsUrl(typeof entry === 'string' ? entry : entry?.url);
    if (!url || out.some((video) => video.url === url)) continue;
    out.push({ url, poster: httpsUrl(entry?.poster) });
  }
  return out;
}

/** A video's cover frame is not a photo: the admin gallery leaves it out. */
export function isVideoPoster(src) {
  return /_poster\.jpe?g(\?|$)/i.test(String(src || ''));
}
