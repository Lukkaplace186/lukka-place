/**
 * A conservative automatic correction for listing photos, run on the phone
 * right before the photo is re-encoded (lib/photoShrink.js).
 *
 * Agents' photos are mostly taken indoors on low-end phones: a yellow or green
 * cast from the room's bulb, flat contrast, dark corners. This corrects the
 * CAMERA, never the PROPERTY — the same no-fabrication rule as every other
 * fact on a listing. A yellow wall stays yellow, a dark room is lifted but
 * does not become a sunny one. Every step is capped for that reason:
 *
 * - White balance is estimated from near-neutral pixels only (low chroma,
 *   mid luminance), applied at WB_STRENGTH of the estimate and capped at
 *   ±WB_MAX_GAIN per channel. A room that really is one colour has few
 *   neutral pixels and is left alone (a plain grey-world average would turn
 *   a yellow room grey).
 * - Contrast is a luminance stretch between the CLIP_PCT and 1-CLIP_PCT
 *   percentiles (one lamp or one black pixel cannot defeat it), with the
 *   black point never moved past BLACK_POINT_MAX and the gain capped at
 *   STRETCH_MAX_GAIN, then a shadow lift that fades to nothing at black and
 *   at white.
 * - Vibrance raises saturation of every hue in proportion to how UNsaturated
 *   it already is — never per-channel (boosting blue/green alone shifts hue:
 *   walls and skin turn cyan). Near-grey pixels are left alone so a residual
 *   cast is not amplified, and the skin/beige hue band gets a third of it.
 * - No sharpening: on a small phone sensor at JPEG 0.82 it amplifies noise
 *   and compression blocks more than edges.
 *
 * A photo that needs none of it returns null from buildEnhancement and is not
 * touched at all.
 *
 * Pure, no DOM, works on any RGB(A) byte array. The engine carries a
 * deliberate CommonJS copy, services/photoEnhance.js, for WhatsApp photos —
 * CHANGE ONE, CHANGE THE OTHER. tests/unit/photo-enhance.test.js runs both on
 * the same pixels and fails if they disagree.
 */

export const SAMPLE_TARGET = 65536;
export const CLIP_PCT = 0.005;

export const NEUTRAL_MAX_CHROMA = 0.3;
export const NEUTRAL_MIN_LUMA = 40;
export const NEUTRAL_MAX_LUMA = 240;
export const WB_MIN_NEUTRAL_FRACTION = 0.05;
export const WB_STRENGTH = 0.6;
export const WB_MAX_GAIN = 0.12;
export const WB_MIN_CORRECTION = 0.015;

export const BLACK_POINT_MIN = 6;
export const BLACK_POINT_MAX = 20;
export const WHITE_POINT_MIN = 235;
export const STRETCH_MAX_GAIN = 1.25;

export const SHADOW_TARGET = 0.42;
export const SHADOW_LIFT_MAX = 0.12;

export const VIBRANCE_MAX = 0.18;
export const VIVID_SATURATION = 0.4;
export const SKIN_PROTECT = 0.3;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function toByte(value) {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Statistics from a sample of the pixels — enough to decide, cheap on a phone. */
export function analyseImage(data, channels = 4) {
  const pixels = Math.floor(data.length / channels);
  const step = Math.max(1, Math.floor(pixels / SAMPLE_TARGET));
  const hist = new Array(256).fill(0);
  let samples = 0;
  let neutralCount = 0;
  let nr = 0;
  let ng = 0;
  let nb = 0;
  let satSum = 0;

  for (let p = 0; p < pixels; p += step) {
    const i = p * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = luma(r, g, b);
    hist[toByte(y)] += 1;
    samples += 1;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const chroma = mx > 0 ? (mx - mn) / mx : 0;
    satSum += chroma;
    if (y >= NEUTRAL_MIN_LUMA && y <= NEUTRAL_MAX_LUMA && chroma <= NEUTRAL_MAX_CHROMA) {
      neutralCount += 1;
      nr += r;
      ng += g;
      nb += b;
    }
  }

  return {
    samples,
    hist,
    neutralCount,
    neutralMean: neutralCount ? [nr / neutralCount, ng / neutralCount, nb / neutralCount] : null,
    meanSaturation: samples ? satSum / samples : 0,
  };
}

function percentile(hist, total, fraction) {
  const target = total * fraction;
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += hist[v];
    if (seen > target) return v;
  }
  return 255;
}

/** Per-channel white-balance gains, luminance-preserving; [1,1,1] when no reliable cast. */
export function whiteBalanceGains(stats) {
  if (!stats.neutralMean || stats.neutralCount < stats.samples * WB_MIN_NEUTRAL_FRACTION) return [1, 1, 1];
  const [r, g, b] = stats.neutralMean;
  const grey = (r + g + b) / 3;
  if (!(r > 0 && g > 0 && b > 0)) return [1, 1, 1];
  let gains = [grey / r, grey / g, grey / b].map((gain) =>
    clamp(1 + (gain - 1) * WB_STRENGTH, 1 - WB_MAX_GAIN, 1 + WB_MAX_GAIN),
  );
  const norm = luma(gains[0], gains[1], gains[2]);
  gains = gains.map((gain) => gain / norm);
  if (gains.every((gain) => Math.abs(gain - 1) < WB_MIN_CORRECTION)) return [1, 1, 1];
  return gains;
}

/**
 * The correction for one photo: three 256-entry lookup tables (white balance,
 * stretch and shadow lift folded together) and a vibrance amount — or null
 * when the photo already needs nothing.
 */
export function buildEnhancement(stats) {
  if (!stats || !stats.samples) return null;
  const gains = whiteBalanceGains(stats);

  const lo = percentile(stats.hist, stats.samples, CLIP_PCT);
  const hi = percentile(stats.hist, stats.samples, 1 - CLIP_PCT);
  const median = percentile(stats.hist, stats.samples, 0.5);

  // A black point a few levels up is sensor noise, not a haze to remove.
  const blackPoint = lo < BLACK_POINT_MIN ? 0 : Math.min(lo, BLACK_POINT_MAX);
  const whitePoint = hi >= WHITE_POINT_MIN ? 255 : hi;
  let gain = whitePoint > blackPoint ? 255 / (whitePoint - blackPoint) : 1;
  gain = clamp(gain, 1, STRETCH_MAX_GAIN);

  const stretchedMedian = clamp(((median - blackPoint) * gain) / 255, 0, 1);
  const lift = stretchedMedian < SHADOW_TARGET ? Math.min(SHADOW_LIFT_MAX, (SHADOW_TARGET - stretchedMedian) * 0.6) : 0;

  const vibrance = VIBRANCE_MAX * clamp((VIVID_SATURATION - stats.meanSaturation) / 0.25, 0, 1);

  const luts = gains.map((channelGain) => {
    const lut = new Array(256);
    for (let v = 0; v < 256; v += 1) {
      let x = clamp(((v * channelGain - blackPoint) * gain) / 255, 0, 1);
      // Peaks at x = 1/3 with exactly `lift`, zero at black and white,
      // monotonic for lift < 0.44.
      x += lift * 6.75 * x * (1 - x) * (1 - x);
      lut[v] = toByte(x * 255);
    }
    return lut;
  });

  const identity = luts.every((lut) => lut.every((out, v) => Math.abs(out - v) <= 1));
  if (identity && vibrance < 0.01) return null;
  return { luts, vibrance };
}

/** Applies a correction in place. */
export function applyEnhancement(data, enhancement, channels = 4) {
  const [lr, lg, lb] = enhancement.luts;
  const vibrance = enhancement.vibrance;
  for (let i = 0; i + 2 < data.length; i += channels) {
    let r = lr[data[i]];
    let g = lg[data[i + 1]];
    let b = lb[data[i + 2]];
    if (vibrance > 0) {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx > 0 && mx > mn) {
        const s = (mx - mn) / mx;
        let w = Math.min(1, s / 0.1) * (1 - s);
        // Skin and beige walls: red highest, hue 0-50°.
        if (r === mx && g >= b && (60 * (g - b)) / (mx - mn) <= 50) w *= SKIN_PROTECT;
        const k = 1 + vibrance * w;
        const y = luma(r, g, b);
        r = y + (r - y) * k;
        g = y + (g - y) * k;
        b = y + (b - y) * k;
      }
    }
    data[i] = toByte(r);
    data[i + 1] = toByte(g);
    data[i + 2] = toByte(b);
  }
  return data;
}

/** analyse → build → apply. Returns true when the pixels were changed. */
export function enhancePixels(data, channels = 4) {
  const enhancement = buildEnhancement(analyseImage(data, channels));
  if (!enhancement) return false;
  applyEnhancement(data, enhancement, channels);
  return true;
}
