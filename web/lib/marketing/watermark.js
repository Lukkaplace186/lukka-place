import { COLORS, baselineOffset, lineBox, wrapText } from './layout';

/**
 * "Photos avec mon logo" — one listing photo with the agent's brand in a band
 * along its bottom edge, as draw operations (lib/marketing/layout.js's
 * vocabulary) for components/marketing/CanvasRenderer.js to paint.
 *
 * The photo is never cropped: the canvas takes the photo's own aspect, and the
 * band sits OVER its bottom edge, 12 % of the shorter side (72–140 px). In it:
 * the agent's logo (or their initials on a royal disc), their name and — only
 * when the caller passes one, i.e. under the listing page's verified-number
 * rule (agentContactPhone) — their phone; "lukkaplace.com" on the right.
 * No name and no logo: the band carries only "lukkaplace.com" — never a Lukka
 * Place mark passed off as the agent's brand.
 */

export const WATERMARK_BAND_RATIO = 0.12;
export const WATERMARK_BAND_MIN = 72;
export const WATERMARK_BAND_MAX = 140;
export const WATERMARK_BAND_FILL = 'rgba(11, 17, 32, 0.74)';
/** Longest edge of an exported photo: the share pack's own 1080 px. */
export const WATERMARK_MAX_EDGE = 1080;

/** Output size for a photo of `iw × ih`, longest edge ≤ WATERMARK_MAX_EDGE, never upscaled. */
export function watermarkSize(iw, ih) {
  if (!(iw > 0) || !(ih > 0)) return null;
  const scale = Math.min(1, WATERMARK_MAX_EDGE / Math.max(iw, ih));
  return { width: Math.round(iw * scale), height: Math.round(ih * scale) };
}

/**
 * @param {{width: number, height: number, agent: {name?, initials?, phone?}, hasLogo: boolean,
 *          measure: (text: string, style: object) => number}} input
 * @returns {{width: number, height: number, ops: object[]}}
 */
export function buildWatermarkOps({ width, height, agent = {}, hasLogo = false, measure }) {
  const band = Math.round(Math.min(WATERMARK_BAND_MAX, Math.max(WATERMARK_BAND_MIN, Math.min(width, height) * WATERMARK_BAND_RATIO)));
  const y = height - band;
  const pad = Math.round(band * 0.16);
  const ops = [
    { type: 'image', key: 'photo:0', x: 0, y: 0, w: width, h: height, fit: 'cover' },
    { type: 'rect', x: 0, y, w: width, h: band, fill: WATERMARK_BAND_FILL },
  ];

  const siteSize = Math.round(band * 0.17);
  const site = 'lukkaplace.com';
  const siteStyle = { size: siteSize, weight: 700 };
  const siteWidth = measure(site, siteStyle);
  ops.push({
    type: 'text', text: site, align: 'right', size: siteSize, weight: 700, color: COLORS.white,
    x: width - pad, y: y + (band - lineBox(siteSize)) / 2 + baselineOffset(siteSize),
  });

  const name = agent?.name ? String(agent.name).trim() : '';
  const initials = agent?.initials ? String(agent.initials).trim() : '';
  if (!name && !hasLogo) return { width, height, ops };

  // The brand block: logo or initials disc, then name / phone.
  const disc = band - 2 * pad;
  let x = pad;
  if (hasLogo) {
    ops.push({ type: 'rect', x, y: y + pad, w: disc, h: disc, fill: COLORS.white, radius: disc / 2 });
    ops.push({ type: 'image', key: 'logo', x: x + disc * 0.1, y: y + pad + disc * 0.1, w: disc * 0.8, h: disc * 0.8, fit: 'contain', radius: disc * 0.4 });
    x += disc + pad;
  } else if (initials) {
    const size = Math.round(disc * 0.42);
    ops.push({ type: 'rect', x, y: y + pad, w: disc, h: disc, fill: COLORS.royal, radius: disc / 2 });
    ops.push({
      type: 'text', text: initials.slice(0, 3).toUpperCase(), align: 'center', size, weight: 800, color: COLORS.white,
      x: x + disc / 2, y: y + pad + (disc - lineBox(size)) / 2 + baselineOffset(size),
    });
    x += disc + pad;
  }

  if (!name) return { width, height, ops };
  const available = Math.max(0, width - x - pad * 2 - siteWidth);
  const nameSize = Math.round(band * 0.24);
  const phoneSize = Math.round(band * 0.19);
  const phone = agent?.phone ? String(agent.phone).trim() : '';
  const nameLine = wrapText(name, available, { size: nameSize, weight: 800 }, 1, measure)[0] || '';
  const block = lineBox(nameSize, 1.1) + (phone ? lineBox(phoneSize, 1.1) : 0);
  const top = y + (band - block) / 2;
  ops.push({
    type: 'text', text: nameLine, align: 'left', size: nameSize, weight: 800, color: COLORS.white,
    x, y: top + baselineOffset(nameSize, 1.1),
  });
  if (phone) {
    ops.push({
      type: 'text', text: phone, align: 'left', size: phoneSize, weight: 500, color: COLORS.white,
      x, y: top + lineBox(nameSize, 1.1) + baselineOffset(phoneSize, 1.1),
    });
  }
  return { width, height, ops };
}

/** "lukka-310-photo-2-logo.jpg". */
export function watermarkFileName(listingId, index) {
  return `lukka-${listingId}-photo-${index + 1}-logo.jpg`;
}
