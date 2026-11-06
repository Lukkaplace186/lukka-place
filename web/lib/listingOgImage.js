import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SITE_URL } from './constants';
import { optimisableImageSrc } from './marketing/sharePackData';
import { OG_SIZE, ogPhotoSlots } from './listingOgCard';

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

/** How many of a listing's photos are fetched to choose the card's three from. */
export const OG_PHOTO_CANDIDATES = 6;

/**
 * Below this mean luminance the cover is too dark to lead the card and the
 * brightest photo takes the large slot instead. Listing 596's photos measured
 * 161–177; a dim night shot is well under 110.
 */
export const OG_DARK_COVER = 110;

/**
 * Mean luminance (0–255) of an image, from a 64px thumbnail. Used to put the
 * brightest photos on the card: agents upload in any order, and the first
 * photo is often a dark corridor or an empty wall.
 */
async function brightness(sharp, buffer) {
  const { channels } = await sharp(buffer).rotate().resize(64, 64, { fit: 'inside' }).removeAlpha().stats();
  const [r, g, b] = channels.map((channel) => channel.mean);
  return 0.2126 * r + 0.7152 * g + 0.0722 * (b ?? g);
}

async function fetchPhoto(src) {
  if (!optimisableImageSrc(src, { supabaseHost: supabaseHost() })) return null;
  try {
    const res = await fetch(new URL(src, SITE_URL), { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length && buffer.length <= MAX_PHOTO_BYTES ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * The Éditorial card's photos (2026-11-06): up to OG_PHOTO_CANDIDATES of the
 * listing's own photos are fetched (`srcs` is lib/listingView.js
 * listingImages: the cover first), byte-identical copies dropped, and three
 * (or fewer) cropped to the slots of lib/listingOgCard.js ogPhotoSlots.
 *
 * The large slot is the COVER — the photo a person chose (the agent, or the
 * team in the admin photo manager) — unless it is darker than OG_DARK_COVER,
 * then the brightest photo. The two small slots are the brightest of the
 * rest: agents upload in any order, and a dark corridor shot often comes
 * second. Brightness alone could not pick the best room (listing 596's eight
 * photos measured within 16 points of each other), which is why a person's
 * cover choice leads. Each photo gets the same light warm grade so three
 * phone photos read as one set. Only the listing's own photos, from our
 * storage: a photo that fails to load is skipped, never replaced.
 *
 * @returns {Promise<Array<{src: string, left: number, top: number, width: number, height: number}>>}
 */
export async function loadOgPhotos(srcs) {
  const sharp = await loadSharp();
  if (!sharp) return [];
  const candidates = [...new Set((srcs || []).filter(Boolean))].slice(0, OG_PHOTO_CANDIDATES);
  const buffers = await Promise.all(candidates.map(fetchPhoto));
  const seen = new Set();
  const usable = [];
  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i];
    if (!buffer) continue;
    const key = `${buffer.length}:${buffer.subarray(0, 64).toString('base64')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      usable.push({ buffer, light: await brightness(sharp, buffer), cover: i === 0 });
    } catch {
      // Undecodable: skipped.
    }
  }
  const chosen = pickOgPhotos(usable);
  const slots = ogPhotoSlots(chosen.length);
  const out = [];
  for (let i = 0; i < chosen.length; i += 1) {
    const slot = slots[i];
    try {
      const jpeg = await sharp(chosen[i].buffer)
        .rotate()
        .resize({ width: Math.round(slot.width), height: Math.round(slot.height), fit: 'cover', position: 'centre' })
        .modulate({ brightness: 1.04, saturation: 1.05 })
        .linear(1.06, -7.7)
        .recomb([[1.03, 0.02, 0], [0.01, 1.01, 0], [0, 0, 0.96]])
        .jpeg({ quality: 88 })
        .toBuffer();
      out.push({ ...slot, src: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
    } catch {
      // A photo that will not crop is left out; the layout was sized for it,
      // so the slot stays ivory rather than borrowing another listing's photo.
    }
  }
  return out;
}

/**
 * The card's photos in slot order: the cover first unless it is too dark,
 * then the brightest of the rest. Pure — exported for the unit tests.
 *
 * @param {Array<{light: number, cover: boolean}>} photos
 */
export function pickOgPhotos(photos) {
  const byLight = [...photos].sort((a, b) => b.light - a.light);
  const cover = photos.find((photo) => photo.cover);
  const lead = cover && cover.light >= OG_DARK_COVER ? cover : byLight[0];
  if (!lead) return [];
  return [lead, ...byLight.filter((photo) => photo !== lead)].slice(0, 3);
}

function brandImage(file) {
  return readFile(path.join(process.cwd(), 'public', 'brand', file))
    .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`);
}

/**
 * The supplied logo in solid white (public/brand/logo-dark.png, 2354×746),
 * read once per process. Sent at its own size; satori scales it. Drawn on the
 * blue block when a listing has no photo.
 */
let wordmarkPromise = null;
export function loadOgWordmark() {
  if (!wordmarkPromise) {
    wordmarkPromise = brandImage('logo-dark.png').catch((err) => {
      console.error(`[og-image] logo unreadable: ${err.message}`);
      wordmarkPromise = null;
      return null;
    });
  }
  return wordmarkPromise;
}

/**
 * The same logo in one colour, brand royal #144FC5 (public/brand/logo-royal.png,
 * made from logo-dark.png's shape): the Éditorial card's ivory column.
 */
let royalPromise = null;
export function loadOgRoyalLogo() {
  if (!royalPromise) {
    royalPromise = brandImage('logo-royal.png').catch((err) => {
      console.error(`[og-image] royal logo unreadable: ${err.message}`);
      royalPromise = null;
      return null;
    });
  }
  return royalPromise;
}

/**
 * DM Serif Display (OFL), the site's display face, for the card's price —
 * TrueType from Google Fonts like Jakarta below. [] on failure: the price
 * then draws in Jakarta.
 */
let serifPromise = null;
export function loadOgSerif() {
  if (!serifPromise) {
    serifPromise = fetchGoogleTtf('DM+Serif+Display', [400], 'Serif').catch((err) => {
      console.error(`[og-image] serif fetch failed, price in Jakarta: ${err.message}`);
      serifPromise = null;
      return [];
    });
  }
  return serifPromise;
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

function fetchJakarta() {
  return fetchGoogleTtf('Plus+Jakarta+Sans', [500, 600, 700, 800], 'Jakarta');
}

async function fetchGoogleTtf(family, weights, name) {
  const spec = weights.length === 1 && weights[0] === 400 ? family : `${family}:wght@${weights.join(';')}`;
  const cssRes = await fetch(`https://fonts.googleapis.com/css2?family=${spec}`, {
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
    fonts.push({ name, data: await res.arrayBuffer(), weight, style: 'normal' });
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
