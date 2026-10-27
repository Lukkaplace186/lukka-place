import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SITE_URL } from './constants';
import { optimisableImageSrc } from './marketing/sharePackData';
import { OG_SIZE } from './listingOgCard';

/**
 * The server half of the listing link preview (app/(site)/listings/[id]/
 * opengraph-image.js): the cover photo, the white logo and the fonts satori
 * (behind next/og) needs, and the PNG → JPEG step.
 *
 * Everything here degrades rather than fails: no photo draws the royal panel
 * (never a stand-in photo), no font draws in next/og's default face, no sharp
 * sends the PNG as it is. A link preview with a plainer face beats none.
 */

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function supabaseHost() {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    return null;
  }
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

/**
 * The listing's cover, cropped to exactly 1200×630 (centre, like
 * object-fit: cover) and re-encoded as JPEG, as a data URI satori can draw.
 *
 * Only our own storage (the share pack's allow-list), fetched with a timeout.
 * sharp is what makes it safe to draw at all: satori decodes neither WebP nor
 * AVIF and ignores EXIF orientation, and the crop here means satori never has
 * to scale a 4000px original. WhatsApp photos are ~720px wide, so most covers
 * are enlarged ~1.7×: soft at full size, sharp at the size a preview is seen.
 *
 * @returns {Promise<string|null>}
 */
export async function loadOgPhoto(src) {
  if (!optimisableImageSrc(src, { supabaseHost: supabaseHost() })) return null;
  let buffer;
  try {
    const res = await fetch(new URL(src, SITE_URL), { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return null;
    buffer = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: OG_SIZE.width, height: OG_SIZE.height, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 86 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * The supplied logo in solid white (public/brand/logo-dark.png, 2354×746),
 * read once per process. Sent at its own size; satori scales it.
 */
let wordmarkPromise = null;
export function loadOgWordmark() {
  if (!wordmarkPromise) {
    wordmarkPromise = readFile(path.join(process.cwd(), 'public', 'brand', 'logo-dark.png'))
      .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
      .catch((err) => {
        console.error(`[og-image] logo unreadable: ${err.message}`);
        wordmarkPromise = null;
        return null;
      });
  }
  return wordmarkPromise;
}

/**
 * Plus Jakarta Sans in the three weights the card uses, fetched once per
 * process from Google Fonts (OFL) as TrueType — next/font only ships woff2,
 * which satori cannot read, and Google serves TTF to a client that does not
 * claim to be a modern browser. The retired server flyer loaded its fonts the
 * same way. A failed fetch resolves to [] and is retried on a later request.
 */
let fontsPromise = null;
export function loadOgFonts() {
  if (!fontsPromise) {
    fontsPromise = fetchJakarta().catch((err) => {
      console.error(`[og-image] font fetch failed, using default face: ${err.message}`);
      fontsPromise = null;
      return [];
    });
  }
  return fontsPromise;
}

async function fetchJakarta() {
  const weights = [600, 700, 800];
  const cssRes = await fetch(`https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@${weights.join(';')}`, {
    headers: { 'User-Agent': 'Mozilla/4.0' },
    signal: AbortSignal.timeout(5000),
  });
  if (!cssRes.ok) throw new Error(`css ${cssRes.status}`);
  const css = await cssRes.text();
  const faces = new Map([...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)/g)].map(([, weight, src]) => [Number(weight), src]));
  const fonts = [];
  for (const weight of weights) {
    const src = faces.get(weight);
    if (!src) continue;
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) continue;
    fonts.push({ name: 'Jakarta', data: await res.arrayBuffer(), weight, style: 'normal' });
  }
  if (!fonts.length) throw new Error('no TrueType faces in the stylesheet');
  return fonts;
}

/**
 * ImageResponse only writes PNG, and a full-bleed photo PNG at 1200×630 is
 * ~1 MB. WhatsApp tends to drop a preview image that heavy, so the card goes
 * out as a ~100 KB JPEG (the retired flyer measured 970 KB → 106 KB the same
 * way). `null` when sharp is unavailable: the caller sends the PNG instead.
 *
 * @returns {Promise<Buffer|null>}
 */
export async function pngToJpeg(png) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await sharp(Buffer.from(png)).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}
