/**
 * services/mediaStorage.js
 *
 * Persists downloaded WhatsApp photos to local disk so a listing keeps its
 * photos after the vision call is done with them — services/openai.js only
 * ever holds them in memory as base64 for the gpt-4o request.
 *
 * Local disk, not cloud storage: this project has no other cloud
 * infrastructure (SQLite, no S3/CDN client), so a local `uploads/` directory
 * served statically by index.js matches everything else here.
 */

const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const LISTINGS_SUBDIR = 'listings';

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Filesystem- and URL-safe: wamids carry characters like '=' '+' '.'. */
function sanitiseKey(key) {
  return String(key).replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Write one or more downloaded images to disk under a shared key (typically
 * the listing's primary wamid), so a photo burst lands together and a
 * redelivery overwrites rather than accumulating duplicates.
 *
 * @param {Array<{data: string, mimeType: string}>} images  As returned by
 *        services/chakra.js downloadMedia/downloadMediaByUrl (base64 `data`).
 * @param {string} key  Groups this burst's files; sanitised for the filesystem.
 * @returns {string[]} Web paths (e.g. '/uploads/listings/<key>-0.jpg') suitable
 *          for storing in the DB and serving via the static mount in index.js.
 */
function persistImages(images, key) {
  if (!images || images.length === 0) return [];

  const safeKey = sanitiseKey(key);
  const dir = path.join(UPLOADS_ROOT, LISTINGS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });

  const paths = [];
  images.forEach((image, index) => {
    const ext = EXTENSION_BY_MIME[image.mimeType] || 'bin';
    const filename = `${safeKey}-${index}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), Buffer.from(image.data, 'base64'));
    paths.push(`/uploads/${LISTINGS_SUBDIR}/${filename}`);
  });

  return paths;
}

/**
 * Write downloaded videos next to the photos, named `<key>-v<i>.<ext>` so a
 * burst's photos and videos never collide and a redelivery overwrites.
 *
 * @param {Array<{buffer: Buffer, mimeType: string}>} videos  chakra.downloadVideo results.
 * @param {string} key
 * @returns {string[]} Web paths ('/uploads/listings/<key>-v0.mp4').
 */
function persistVideos(videos, key) {
  if (!videos || videos.length === 0) return [];
  const { VIDEO_EXTENSION_BY_MIME } = require('./listingMedia');
  const safeKey = sanitiseKey(key);
  const dir = path.join(UPLOADS_ROOT, LISTINGS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return videos.map((video, index) => {
    const ext = VIDEO_EXTENSION_BY_MIME[video.mimeType] || 'mp4';
    const filename = `${safeKey}-v${index}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), video.buffer);
    return `/uploads/${LISTINGS_SUBDIR}/${filename}`;
  });
}

module.exports = {
  persistImages,
  persistVideos,
  UPLOADS_ROOT,
};
