/**
 * Shrinks a listing photo on the phone, before it is uploaded.
 *
 * A current Android camera produces a 3-6 MB, 4000px JPEG. Uploaded as-is,
 * ten of them is a 40 MB Server Action body: five to eleven minutes on a
 * 0.5-1 Mbps Kinshasa uplink, in one all-or-nothing request with no progress.
 * The storefront never shows a listing photo wider than 1600px (next/image
 * resizes everything down again anyway), so those extra pixels cost the agent
 * minutes and data and buy nothing.
 *
 * Re-encoded at 1600px on the long edge, JPEG ~0.82, a photo lands around
 * 200-400 KB — ten to fifteen times smaller. EXIF goes with the re-encode, GPS
 * position included, which is a privacy improvement rather than a loss: a
 * listing photo taken at the property should not publish its coordinates.
 *
 * Never worse than before: anything this cannot decode, an already-small
 * file, or a result that is not actually smaller returns the ORIGINAL file,
 * and the server's own validation (lib/uploadLimits.mjs) still applies to
 * whatever is sent. Photos are processed one at a time on purpose — a
 * 4000×3000 decode is ~48 MB of pixels, and doing ten at once is how a 2 GB
 * phone kills the tab.
 */

export const SHRINK_MAX_EDGE = 1600;
export const SHRINK_QUALITY = 0.82;
/** Below this a re-encode saves too little to be worth the decode. */
export const SHRINK_SKIP_BELOW_BYTES = 400 * 1024;

const SHRINKABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** The output size for a photo — never upscales, never returns a zero side. */
export function shrinkTargetSize(width, height, maxEdge = SHRINK_MAX_EDGE) {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** True when a file is worth decoding at all. */
export function shouldShrink(file) {
  return Boolean(file) && SHRINKABLE_TYPES.includes(file.type) && Number(file.size) > SHRINK_SKIP_BELOW_BYTES;
}

export function shrunkFileName(name) {
  const base = String(name || 'photo').replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.jpg`;
}

export async function shrinkPhoto(file) {
  if (!shouldShrink(file)) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = shrinkTargetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    // A transparent PNG would otherwise flatten onto black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRINK_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], shrunkFileName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

export async function shrinkPhotos(files) {
  const out = [];
  for (const file of files) {
    out.push(await shrinkPhoto(file));
  }
  return out;
}
