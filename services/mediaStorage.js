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

module.exports = {
  persistImages,
  UPLOADS_ROOT,
};
