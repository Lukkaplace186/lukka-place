/**
 * services/photoEnhance.js — the conservative listing-photo correction, for
 * photos that arrive over WhatsApp and never pass through a browser.
 *
 * A DELIBERATE COPY of web/lib/photoEnhance.js (the engine is CommonJS and
 * outside web's module graph, same as the landmark rule in
 * scripts/geocode-listings.js). CHANGE ONE, CHANGE THE OTHER — everything
 * above enhanceImageBuffer is byte-for-byte the web logic, and
 * web/tests/unit/photo-enhance.test.js runs both on the same pixels. The
 * rules, and why each step is capped, are in the web file's header.
 */

const SAMPLE_TARGET = 65536;
const CLIP_PCT = 0.005;

const NEUTRAL_MAX_CHROMA = 0.3;
const NEUTRAL_MIN_LUMA = 40;
const NEUTRAL_MAX_LUMA = 240;
const WB_MIN_NEUTRAL_FRACTION = 0.05;
const WB_STRENGTH = 0.6;
const WB_MAX_GAIN = 0.12;
const WB_MIN_CORRECTION = 0.015;

const BLACK_POINT_MIN = 6;
const BLACK_POINT_MAX = 20;
const WHITE_POINT_MIN = 235;
const STRETCH_MAX_GAIN = 1.25;

const SHADOW_TARGET = 0.42;
const SHADOW_LIFT_MAX = 0.12;

const VIBRANCE_MAX = 0.18;
const VIVID_SATURATION = 0.4;
const SKIN_PROTECT = 0.3;

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
function analyseImage(data, channels = 4) {
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
function whiteBalanceGains(stats) {
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
function buildEnhancement(stats) {
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
function applyEnhancement(data, enhancement, channels = 4) {
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
function enhancePixels(data, channels = 4) {
  const enhancement = buildEnhancement(analyseImage(data, channels));
  if (!enhancement) return false;
  applyEnhancement(data, enhancement, channels);
  return true;
}

// ---------------------------------------------------------------------------
// Engine only: files in, files out.
// ---------------------------------------------------------------------------

/**
 * Bumped whenever the correction above changes, so a re-run writes new object
 * names instead of overwriting URLs next/image has cached for 30 days.
 */
const ENHANCE_VERSION = 'e1';
const ENHANCEABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const OUTPUT_JPEG_QUALITY = 85;

/** 'properties/9/whatsapp_ab12.png' -> 'properties/9/whatsapp_ab12_e1.jpg' (output is always JPEG). */
function enhancedObjectName(name) {
  const base = String(name).replace(/\.[^./]+$/, '');
  return `${base}_${ENHANCE_VERSION}.jpg`;
}

/** True for an object this version (or any version) already produced. */
function isEnhancedObjectName(name) {
  return /_e\d+\.jpg$/i.test(String(name));
}

function isEnhanceableExtension(ext) {
  return ENHANCEABLE_EXTENSIONS.includes(String(ext || '').toLowerCase());
}

/**
 * Decode, correct, re-encode. Resolves { buffer, enhanced }: `enhanced: false`
 * with the ORIGINAL bytes when the photo needs nothing, cannot be decoded, or
 * anything fails — never worse than uploading the original, which is what
 * happened before this existed. EXIF orientation is baked in and metadata
 * (GPS included) is not carried to the output.
 */
async function enhanceImageBuffer(buffer) {
  try {
    const sharp = require('sharp');
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (!enhancePixels(data, info.channels)) return { buffer, enhanced: false };
    const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .jpeg({ quality: OUTPUT_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { buffer: out, enhanced: true };
  } catch (err) {
    console.warn(`[photoEnhance] left as-is: ${err.message}`);
    return { buffer, enhanced: false };
  }
}

module.exports = {
  SAMPLE_TARGET,
  CLIP_PCT,
  NEUTRAL_MAX_CHROMA,
  NEUTRAL_MIN_LUMA,
  NEUTRAL_MAX_LUMA,
  WB_MIN_NEUTRAL_FRACTION,
  WB_STRENGTH,
  WB_MAX_GAIN,
  WB_MIN_CORRECTION,
  BLACK_POINT_MIN,
  BLACK_POINT_MAX,
  WHITE_POINT_MIN,
  STRETCH_MAX_GAIN,
  SHADOW_TARGET,
  SHADOW_LIFT_MAX,
  VIBRANCE_MAX,
  VIVID_SATURATION,
  SKIN_PROTECT,
  analyseImage,
  whiteBalanceGains,
  buildEnhancement,
  applyEnhancement,
  enhancePixels,
  ENHANCE_VERSION,
  enhancedObjectName,
  isEnhancedObjectName,
  isEnhanceableExtension,
  enhanceImageBuffer,
};
