/**
 * services/listingMedia.js
 *
 * Photos AND videos of a listing (2026-10-21). After launch, agents were seen
 * sending videos alongside their photos; the videos were answered with "format
 * pas encore pris en charge" and lost. Now a video is kept, published with the
 * listing, and counts towards the publish rule: a listing needs at least ONE
 * photo or ONE video, never neither.
 *
 * - Caps: MAX_LISTING_PHOTOS (20, same as web/lib/uploadLimits.mjs — change one,
 *   change the other) and MAX_LISTING_VIDEOS (3). services/db.js applies them
 *   on every write, so no path can store more.
 * - The vision model still reads at most OPENAI_MAX_IMAGES photos
 *   (services/openai.js, 10): extraction needs a few photos, not twenty, and
 *   every photo costs tokens. Every photo is still stored and published.
 * - A video's cover frame (posterForVideo) is cut with ffmpeg — FFMPEG_PATH,
 *   else the ffmpeg-static binary, else `ffmpeg` on PATH. It is the listing's
 *   card image when the listing has no photo, so a video-only listing is not
 *   shown with the "no image" placeholder. No ffmpeg → no cover, never a
 *   failure: the video itself is kept and published.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_LISTING_PHOTOS = 20;
const MAX_LISTING_VIDEOS = Number.parseInt(process.env.MAX_LISTING_VIDEOS, 10) || 3;

/** WhatsApp caps an inbound video at 16 MB; anything far above is not a phone clip. */
const MAX_VIDEO_BYTES = Number.parseInt(process.env.MAX_VIDEO_BYTES, 10) || 64 * 1024 * 1024;

const VIDEO_EXTENSION_BY_MIME = {
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const VIDEO_CONTENT_TYPE_BY_EXT = Object.fromEntries(
  Object.entries(VIDEO_EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

function isVideoMime(mimeType) {
  return /^video\//i.test(String(mimeType || '').trim());
}

function isVideoPath(webPath) {
  const ext = path.extname(String(webPath || '')).slice(1).toLowerCase();
  return Boolean(VIDEO_CONTENT_TYPE_BY_EXT[ext]);
}

/**
 * Identify a video from its first bytes. MP4 / MOV / 3GP all open with an
 * ISO-BMFF `ftyp` box at offset 4; WebM with the EBML magic. Used to refuse an
 * HTML error page served with status 200, exactly as chakra.sniffMimeType does
 * for photos.
 */
function sniffVideoMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (brand.startsWith('qt')) return 'video/quicktime';
    if (brand.startsWith('3g')) return 'video/3gpp';
    return 'video/mp4';
  }
  if (buffer.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return null;
}

/** Every photo or video counts; a listing with neither is not publishable. */
function mediaCount(row) {
  const photos = Array.isArray(row?.photos) ? row.photos.length : 0;
  const videos = Array.isArray(row?.videos) ? row.videos.length : 0;
  return photos + videos;
}

function hasVisualMedia(row) {
  return mediaCount(row) > 0;
}

/**
 * Merge new paths onto existing ones, deduplicated, never past `max`.
 * Existing paths always win: a listing's first photos are the ones the agent
 * chose to lead with.
 */
function mergeCapped(existing, added, max) {
  const out = [];
  for (const entry of [...(existing || []), ...(added || [])]) {
    if (!entry || out.includes(entry)) continue;
    if (out.length >= max) break;
    out.push(entry);
  }
  return out;
}

let resolvedFfmpeg;
function ffmpegPath() {
  if (resolvedFfmpeg !== undefined) return resolvedFfmpeg;
  if (process.env.FFMPEG_PATH) {
    resolvedFfmpeg = process.env.FFMPEG_PATH;
    return resolvedFfmpeg;
  }
  try {
    // eslint-disable-next-line global-require
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) {
      resolvedFfmpeg = bundled;
      return resolvedFfmpeg;
    }
  } catch {
    // Not installed, or its install script was not allowed to fetch the binary.
  }
  resolvedFfmpeg = 'ffmpeg';
  return resolvedFfmpeg;
}

/**
 * Cut one JPEG frame (about 1 s in, or the first frame of a shorter clip)
 * next to the video: '/uploads/listings/x-v0.mp4' → 'x-v0.poster.jpg'.
 *
 * @param {string} localVideoPath  Absolute path on disk.
 * @returns {Promise<string|null>} Absolute path of the JPEG, or null when
 *          ffmpeg is missing or cannot read the file.
 */
function posterForVideo(localVideoPath, { timeoutMs = 20000 } = {}) {
  const posterPath = localVideoPath.replace(/\.[^.\\/]+$/, '') + '.poster.jpg';
  if (fs.existsSync(posterPath)) return Promise.resolve(posterPath);
  const run = (seek) => new Promise((resolve) => {
    execFile(
      ffmpegPath(),
      ['-y', '-loglevel', 'error', '-ss', seek, '-i', localVideoPath, '-frames:v', '1', '-vf', 'scale=min(1600\\,iw):-2', '-q:v', '3', posterPath],
      { timeout: timeoutMs, windowsHide: true },
      (err) => resolve(!err && fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0),
    );
  });
  return run('1').then((ok) => (ok ? true : run('0'))).then((ok) => {
    if (ok) return posterPath;
    console.warn(`[media] no cover frame for ${path.basename(localVideoPath)} (ffmpeg: ${ffmpegPath()})`);
    return null;
  });
}

module.exports = {
  MAX_LISTING_PHOTOS,
  MAX_LISTING_VIDEOS,
  MAX_VIDEO_BYTES,
  VIDEO_EXTENSION_BY_MIME,
  VIDEO_CONTENT_TYPE_BY_EXT,
  isVideoMime,
  isVideoPath,
  sniffVideoMime,
  mediaCount,
  hasVisualMedia,
  mergeCapped,
  posterForVideo,
  ffmpegPath,
};
