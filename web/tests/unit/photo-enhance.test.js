import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  analyseImage,
  buildEnhancement,
  applyEnhancement,
  enhancePixels,
  whiteBalanceGains,
  STRETCH_MAX_GAIN,
} from '@/lib/photoEnhance';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_COPY = path.join(WEB, '..', 'services', 'photoEnhance.js');

// Deterministic noise so synthetic photos have real histograms.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** w×h RGBA image; `pixel(x, y, rand)` returns [r, g, b]. */
function image(w, h, pixel, seed = 7) {
  const rand = rng(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = pixel(x, y, rand);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

function mean(data, channel) {
  let sum = 0;
  for (let i = channel; i < data.length; i += 4) sum += data[i];
  return sum / (data.length / 4);
}

const lumaOf = (d) => 0.299 * mean(d, 0) + 0.587 * mean(d, 1) + 0.114 * mean(d, 2);

// A room lit by a warm bulb: grey walls read yellow, some furniture, dark corners.
const warmRoom = (x, y, rand) => {
  const shade = 60 + (x + y) * 1.2 + rand() * 20;
  if (x < 12) return [shade * 0.5 + 40, shade * 0.3 + 20, shade * 0.2 + 10]; // brown sofa
  return [shade * 1.12, shade * 1.0, shade * 0.78];
};

test('a warm bulb cast on grey walls is pulled toward neutral, not all the way', () => {
  const data = image(64, 48, warmRoom);
  const before = mean(data, 0) - mean(data, 2);
  assert.ok(enhancePixels(data));
  const after = mean(data, 0) - mean(data, 2);
  assert.ok(after < before, `red-blue gap ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  assert.ok(after > 0, 'the correction is partial: still slightly warm');
});

// Scenes a phone actually takes: most have a bright window or wall, which is
// exactly what made e2 darken them (black point pulled down, no white lift).
const SCENES = {
  'bright room with a window': (x, y, rand) => {
    if (x > 48 && y < 20) return [250, 250, 248]; // window
    const v = 110 + x * 0.9 + rand() * 25;
    return [v * 1.06, v, v * 0.9];
  },
  'mid-grey room': (x, y, rand) => {
    const v = 40 + x * 2 + rand() * 30;
    return [v, v * 0.98, v * 0.94];
  },
  'dark room': (x, y, rand) => {
    const v = 12 + x * 0.9 + y * 0.4 + rand() * 15;
    return [v * 1.1, v, v * 0.85];
  },
  'colourful bright exterior': (x, y, rand) => {
    if (y < 16) return [150 + rand() * 20, 190 + rand() * 20, 235];
    if (x % 9 < 4) return [60 + rand() * 30, 140 + rand() * 30, 50];
    return [200 + rand() * 40, 120 + rand() * 30, 90];
  },
};

for (const [name, pixel] of Object.entries(SCENES)) {
  test(`never darker: ${name}`, () => {
    const data = image(64, 48, pixel);
    const before = lumaOf(data);
    enhancePixels(data);
    const after = lumaOf(data);
    assert.ok(after >= before - 0.5, `mean luminance ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  });
}

test('black stays black and white stays white', () => {
  const data = image(64, 48, (x, y, rand) => {
    if (x < 4) return [0, 0, 0];
    if (x > 59) return [255, 255, 255];
    const v = 60 + x + rand() * 20;
    return [v, v, v];
  });
  enhancePixels(data);
  assert.deepEqual([data[0], data[1], data[2]], [0, 0, 0]);
  const last = (48 * 64 - 1) * 4;
  assert.deepEqual([data[last], data[last + 1], data[last + 2]], [255, 255, 255]);
});

test('a room that really is yellow stays yellow', () => {
  const data = image(64, 48, (x, y, rand) => {
    const v = rand() * 20;
    return [205 + v, 185 + v, 110 + v];
  });
  const stats = analyseImage(data);
  assert.deepEqual(whiteBalanceGains(stats), [1, 1, 1], 'no neutral pixels, no white balance');
  enhancePixels(data);
  assert.ok(mean(data, 0) - mean(data, 2) > 80, 'blue stays far below red');
  assert.ok(mean(data, 1) - mean(data, 2) > 60);
});

test('a light, neutral, colourful photo is not touched at all', () => {
  // Already light (median above LIGHTNESS_TARGET), neutral greys, strong colours.
  const colours = [[255, 120, 40], [80, 240, 60], [70, 180, 255]];
  const data = image(64, 48, (x, y, rand) => {
    if (y < 18) {
      const v = Math.min(255, (100 + x * 2.4 + rand() * 4) | 0);
      return [v, v, v];
    }
    return colours[x % 3];
  });
  const stats = analyseImage(data);
  assert.equal(buildEnhancement(stats), null);
});

test('a dark room is lifted, capped, and its highlights do not clip', () => {
  const data = image(64, 48, (x, y, rand) => {
    const v = 15 + x * 1.6 + rand() * 10;
    return [v, v, v];
  });
  const before = lumaOf(data);
  const brightestBefore = Math.max(...data.filter((_, i) => i % 4 === 0));
  enhancePixels(data);
  const after = lumaOf(data);
  assert.ok(after > before + 10, `lifted ${before.toFixed(0)} -> ${after.toFixed(0)}`);
  assert.ok(after < before * STRETCH_MAX_GAIN + 40, 'not turned into a bright room');
  const brightestAfter = Math.max(...data.filter((_, i) => i % 4 === 0));
  assert.ok(brightestAfter < 255, `brightest ${brightestBefore} -> ${brightestAfter}`);
});

test('vibrance leaves a fully saturated colour alone and protects skin tones', () => {
  const enhancement = { luts: [0, 1, 2].map(() => Array.from({ length: 256 }, (_, v) => v)), vibrance: 0.18 };
  const red = new Uint8ClampedArray([255, 0, 0, 255]);
  applyEnhancement(red, enhancement);
  assert.deepEqual([...red], [255, 0, 0, 255]);

  const skin = new Uint8ClampedArray([200, 150, 120, 255]);
  const sky = new Uint8ClampedArray([120, 150, 200, 255]);
  applyEnhancement(skin, enhancement);
  applyEnhancement(sky, enhancement);
  const spread = (px) => Math.max(px[0], px[1], px[2]) - Math.min(px[0], px[1], px[2]);
  assert.ok(spread(sky) - 80 > 3 * (spread(skin) - 80), `sky +${spread(sky) - 80}, skin +${spread(skin) - 80}`);
});

test('works on 3-channel buffers (the engine hands sharp raw RGB)', () => {
  const rgba = image(32, 24, warmRoom);
  const rgb = new Uint8ClampedArray((rgba.length / 4) * 3);
  for (let p = 0; p < rgba.length / 4; p += 1) {
    rgb[p * 3] = rgba[p * 4];
    rgb[p * 3 + 1] = rgba[p * 4 + 1];
    rgb[p * 3 + 2] = rgba[p * 4 + 2];
  }
  enhancePixels(rgba, 4);
  enhancePixels(rgb, 3);
  for (let p = 0; p < rgba.length / 4; p += 1) {
    assert.equal(rgb[p * 3], rgba[p * 4]);
    assert.equal(rgb[p * 3 + 2], rgba[p * 4 + 2]);
  }
});

test('the engine copy (services/photoEnhance.js) produces the same pixels', { skip: !fs.existsSync(ENGINE_COPY) }, () => {
  const engine = createRequire(import.meta.url)(ENGINE_COPY);
  const scenes = [
    image(64, 48, warmRoom, 1),
    image(64, 48, (x, y, r) => [30 + r() * 40, 60 + x, 40 + y], 2),
    image(64, 48, (x, y, r) => [200 + r() * 50, 190 + r() * 50, 170 + r() * 50], 3),
  ];
  for (const scene of scenes) {
    const web = Uint8ClampedArray.from(scene);
    const eng = Uint8ClampedArray.from(scene);
    enhancePixels(web);
    engine.enhancePixels(eng);
    assert.deepEqual(eng, web);
  }
});

test('the web and engine copies carry identical logic', { skip: !fs.existsSync(ENGINE_COPY) }, () => {
  const web = fs.readFileSync(path.join(WEB, 'lib', 'photoEnhance.js'), 'utf8');
  const engine = fs.readFileSync(ENGINE_COPY, 'utf8');
  const webBody = web.slice(web.indexOf('export const SAMPLE_TARGET')).replace(/export (const|function) /g, '$1 ').trim();
  const engineBody = engine.slice(engine.indexOf('const SAMPLE_TARGET'), engine.indexOf('// ----')).trim();
  assert.equal(engineBody, webBody, 'services/photoEnhance.js has drifted from web/lib/photoEnhance.js');
});

test('shrinkPhoto corrects the canvas inside its own try/catch, before encoding', () => {
  const source = fs.readFileSync(path.join(WEB, 'lib', 'photoShrink.js'), 'utf8');
  const helper = source.slice(source.indexOf('function enhanceCanvas'), source.indexOf('export async function shrinkPhoto'));
  assert.match(helper, /try \{[\s\S]*enhancePixels\(image\.data, 4\)[\s\S]*\} catch/);
  const draw = source.indexOf('context.drawImage(bitmap');
  const enhance = source.indexOf('enhanceCanvas(context, width, height);');
  const encode = source.indexOf("canvas.toBlob");
  assert.ok(draw > 0 && draw < enhance && enhance < encode);
  // The default 'low' smoothing blurs a 4000px -> 1600px downscale.
  const smoothing = source.indexOf("context.imageSmoothingQuality = 'high'");
  assert.ok(smoothing > 0 && smoothing < draw, 'high-quality smoothing is set before drawing');
});
