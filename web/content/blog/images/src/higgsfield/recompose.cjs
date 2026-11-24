// Shrinks a generated still life onto a matching white 3840×2160 canvas so its objects sit in
// the band the /guides cards keep visible: centred, at most `span` of the width, low in the frame.
// usage: [MAX_SCALE=1.25] node recompose.cjs <in.png> <out.png> [span=0.6] [centerY=0.66]
// Used (2026-11-13; the cards show the whole 16:9 picture under the title): titre foncier
// 0.84 / 0.53; 3 + 1 + 1 0.84 / 0.5 with MAX_SCALE=1.25 (its envelopes came back at 68 % width).
const sharp = require('sharp');

(async () => {
  const [, , input, output, spanArg, cyArg] = process.argv;
  const SPAN = Number(spanArg || 0.6), CY = Number(cyArg || 0.66);
  const W = 3840, H = 2160;
  const WHITE_POINT = 240;
  const lifted = await sharp(input).removeAlpha().linear(255 / WHITE_POINT, 0).png().toBuffer();
  const { data, info } = await sharp(lifted).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => (y * info.width + x) * 3;

  // Objects: anything clearly darker or more coloured than the white set.
  let x0 = info.width, x1 = 0, y0 = info.height, y1 = 0;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const i = at(x, y), r = data[i], g = data[i + 1], b = data[i + 2];
      const min = Math.min(r, g, b), max = Math.max(r, g, b);
      if (min < 200 || max - min > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
  }
  // Background: mean of the outer 40 px ring.
  let n = 0; const sum = [0, 0, 0];
  for (let y = 0; y < info.height; y += 8) for (let x = 0; x < info.width; x += 8) {
    if (x > 40 && x < info.width - 40 && y > 40 && y < info.height - 40) continue;
    const i = at(x, y); sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++;
  }
  const bg = sum.map((v) => Math.round(v / n));

  const k = Math.min(Number(process.env.MAX_SCALE || 1), (SPAN * W) / (x1 - x0));
  const sw = Math.round(info.width * k), sh = Math.round(info.height * k);
  const cx = ((x0 + x1) / 2) * k, cy = ((y0 + y1) / 2) * k;
  const left = Math.round(W / 2 - cx), top = Math.round(H * CY - cy);

  // Feathered edges so the shrunken frame melts into the canvas.
  const f = Math.round(Math.min(sw, sh) * 0.16);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><defs><filter id="b"><feGaussianBlur stdDeviation="${f / 2}"/></filter></defs>` +
    `<rect x="${f}" y="${f}" width="${sw - 2 * f}" height="${sh - 2 * f}" fill="#fff" filter="url(#b)"/></svg>`,
  );
  const alpha = await sharp(mask).resize(sw, sh).extractChannel(0).toBuffer();
  const scaled = await sharp(lifted).resize(sw, sh).joinChannel(alpha).png().toBuffer();

  if (sw >= W && sh >= H) {
    // Enlarged past the canvas (MAX_SCALE > 1): crop the frame, kept inside the picture.
    const cl = Math.min(0, Math.max(W - sw, left)), ct = Math.min(0, Math.max(H - sh, top));
    await sharp(lifted).resize(sw, sh).extract({ left: -cl, top: -ct, width: W, height: H }).png().toFile(output);
    console.log(`cropped at ${-cl},${-ct} (objects now centred at y ${(((cy + ct) / H) * 100).toFixed(0)}%)`);
  } else {
    await sharp({ create: { width: W, height: H, channels: 3, background: { r: bg[0], g: bg[1], b: bg[2] } } })
      .composite([{ input: scaled, left, top }])
      .png()
      .toFile(output);
  }
  const pct = (v, t) => `${((v / t) * 100).toFixed(0)}%`;
  console.log(`${input}: objects x ${pct(x0, info.width)}–${pct(x1, info.width)} y ${pct(y0, info.height)}–${pct(y1, info.height)} → scale ${k.toFixed(2)}, ` +
    `now x ${pct(left + x0 * k, W)}–${pct(left + x1 * k, W)} y ${pct(top + y0 * k, H)}–${pct(top + y1 * k, H)}, bg rgb(${bg})`);
})();
