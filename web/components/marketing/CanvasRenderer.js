'use client';

import { buildFlyerOps, buildReportOps } from '@/lib/marketing/layout';
import { EXPORT_BYTE_BUDGET, EXPORT_JPEG_QUALITY } from '@/lib/marketing/formats';
import { CHECK_PATH, CHECK_STROKE_WIDTH, WHATSAPP_PATH } from '@/lib/marketing/icons';

/**
 * Paints lib/marketing/layout.js's draw operations onto a canvas, in the
 * agent's browser, and exports a JPEG. No server, no API, no library: the
 * Canvas 2D API does all of it.
 *
 * Not html2canvas / dom-to-image: those photograph laid-out DOM and do not
 * implement `object-fit: cover`, so listing photos come out stretched. The
 * crop here is computed explicitly (`drawImage`).
 *
 * Images arrive as Blobs from same-origin URLs (lib/marketing/sharePackData.js),
 * so the canvas is never tainted and `toBlob` never throws a SecurityError.
 * `createImageBitmap` applies the photo's EXIF orientation by default, which is
 * what the server flyer needed sharp for.
 */

const FALLBACK_FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif";

/**
 * The page's own Plus Jakarta Sans, as next/font named it (a hashed family
 * behind `--font-jakarta`), loaded in both weights the graphics use. Offline
 * this still works: next/font self-hosts the files under /_next/static, which
 * the service worker caches.
 */
export async function loadRenderFont() {
  let family = FALLBACK_FAMILY;
  try {
    const declared = getComputedStyle(document.documentElement).getPropertyValue('--font-jakarta').trim();
    if (declared) family = declared;
    await Promise.all([500, 800].map((weight) => document.fonts.load(`${weight} 40px ${family}`)));
  } catch {
    // Canvas falls back through the stack; a plainer face beats no graphic.
  }
  return family;
}

async function decode(blob) {
  if (!blob) return null;
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
  } catch {
    // Fall through to <img>, which some older Safari versions decode more readily.
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decodes once, so switching format does not decode three photos again.
 * A photo that fails to decode is dropped and the next one moves up.
 */
export async function decodeAssets({ photos = [], logo = null, mark = null }) {
  const [decodedPhotos, decodedLogo, decodedMark] = await Promise.all([
    Promise.all(photos.map(decode)),
    decode(logo),
    decode(mark),
  ]);
  const images = {};
  decodedPhotos.filter(Boolean).slice(0, 3).forEach((bitmap, i) => {
    images[`photo:${i}`] = bitmap;
  });
  if (decodedLogo) images.logo = decodedLogo;
  if (decodedMark) images.mark = decodedMark;
  return {
    images,
    photoCount: decodedPhotos.filter(Boolean).slice(0, 3).length,
    hasLogo: Boolean(decodedLogo),
    hasMark: Boolean(decodedMark),
  };
}

const fontString = (family, size, weight) => `${weight} ${size}px ${family}`;

export function createMeasure(ctx, family) {
  return (text, { size, weight = 500, letterSpacing = 0 }) => {
    ctx.font = fontString(family, size, weight);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return ctx.measureText(String(text)).width + letterSpacing * String(text).length;
  };
}

function roundedRectPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius || 0, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sourceSize(image) {
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
}

function drawImage(ctx, image, op) {
  const { width: iw, height: ih } = sourceSize(image);
  if (!iw || !ih) return;
  ctx.save();
  if (op.radius) {
    roundedRectPath(ctx, op.x, op.y, op.w, op.h, op.radius);
    ctx.clip();
  }
  if (op.fit === 'contain') {
    const scale = Math.min(op.w / iw, op.h / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.drawImage(image, op.x + (op.w - w) / 2, op.y + (op.h - h) / 2, w, h);
  } else {
    // cover: crop the source to the box's aspect, centred — what CSS object-fit does.
    const scale = Math.max(op.w / iw, op.h / ih);
    const sw = op.w / scale;
    const sh = op.h / scale;
    ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, op.x, op.y, op.w, op.h);
  }
  ctx.restore();
}

let paths = null;
function glyphs() {
  if (!paths) paths = { whatsapp: new Path2D(WHATSAPP_PATH), check: new Path2D(CHECK_PATH) };
  return paths;
}

function drawIcon(ctx, op) {
  ctx.save();
  ctx.translate(op.x, op.y);
  ctx.scale(op.size / 24, op.size / 24);
  if (op.name === 'check') {
    ctx.strokeStyle = op.color;
    ctx.lineWidth = CHECK_STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(glyphs().check);
  } else {
    ctx.fillStyle = op.color;
    ctx.fill(glyphs().whatsapp);
  }
  ctx.restore();
}

function drawText(ctx, op, family) {
  ctx.font = fontString(family, op.size, op.weight);
  ctx.fillStyle = op.color;
  ctx.textBaseline = 'alphabetic';
  const spacing = op.letterSpacing || 0;
  if (!spacing) {
    ctx.textAlign = op.align || 'left';
    ctx.fillText(op.text, op.x, op.y);
    return;
  }
  // Per-character, so the spacing matches measure() in every browser whether
  // or not it supports ctx.letterSpacing.
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  let x = op.x;
  for (const char of op.text) {
    ctx.fillText(char, x, op.y);
    x += ctx.measureText(char).width + spacing;
  }
}

export function paint(ctx, ops, images, family) {
  for (const op of ops) {
    if (op.type === 'rect') {
      ctx.fillStyle = op.fill;
      if (op.radius) {
        roundedRectPath(ctx, op.x, op.y, op.w, op.h, op.radius);
        ctx.fill();
      } else {
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
    } else if (op.type === 'image') {
      const image = images[op.key];
      if (image) drawImage(ctx, image, op);
    } else if (op.type === 'text') {
      drawText(ctx, op, family);
    } else if (op.type === 'icon') {
      drawIcon(ctx, op);
    }
  }
}

/**
 * JPEG via toDataURL, NOT toBlob. Chromium encodes toBlob in an idle task it
 * is free to defer, and it does: measured in the app's own browser pane, every
 * toBlob took ~1,050 ms whatever the size (540px, 1080px, 2160px, even PNG),
 * while toDataURL encoded the same 1080×1080 JPEG in 32 ms. The synchronous
 * encode blocks the main thread for those few tens of milliseconds, which is
 * acceptable for an image the agent just asked for; a second of dead air on
 * every format switch is not.
 */
function toJpegBlob(canvas, quality) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('canvas export failed');
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function exportJpeg(canvas) {
  const blob = toJpegBlob(canvas, EXPORT_JPEG_QUALITY);
  // Busy photos can push a browser encoder past the budget; one lower pass.
  if (blob.size <= EXPORT_BYTE_BUDGET) return blob;
  return toJpegBlob(canvas, EXPORT_JPEG_QUALITY - 0.12);
}

async function render(build, family, images, markName) {
  const started = performance.now();
  const probe = document.createElement('canvas').getContext('2d');
  const { width, height, ops } = build(createMeasure(probe, family));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  paint(ctx, ops, images, family);
  const blob = await exportJpeg(canvas);
  const ms = performance.now() - started;
  try {
    performance.measure(markName, { start: started, duration: ms });
  } catch {
    // Older browsers without the options form of measure(); timing is diagnostic only.
  }
  // Frees the backing store now rather than at the next GC — 1080×1920×4 is 8 MB.
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width, height, ms };
}

/**
 * @param {object} pack  Share pack.
 * @param {'square'|'story'|'landscape'} formatKey
 * @param {{images, photoCount, hasLogo, hasMark}} assets  From decodeAssets.
 * @param {string} family  From loadRenderFont.
 */
export function renderFlyer(pack, formatKey, assets, family) {
  return render(
    (measure) => buildFlyerOps(pack, formatKey, { measure, photoCount: assets.photoCount, hasLogo: assets.hasLogo, hasMark: assets.hasMark }),
    family,
    assets.images,
    `lp-flyer-${formatKey}`,
  );
}

export function renderReport(report, assets, family) {
  return render(
    (measure) => buildReportOps(report, { measure, hasPhoto: assets.photoCount > 0, hasMark: assets.hasMark }),
    family,
    assets.images,
    'lp-report',
  );
}
