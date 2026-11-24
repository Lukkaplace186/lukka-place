// Shared ground for the Cadastral Quiet covers: grain, survey grid, vignette.
const NS = 'http://www.w3.org/2000/svg';
const W = 3840, H = 2160;

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixColor = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(mix(v, B[i], t))).join(',')})`; };

function ground(svg) {
  const defs = el('defs', {}, svg);
  // Survey grid: 80 px module, a heavier line every 5, fading toward the edges.
  const fine = el('pattern', { id: 'fine', width: 80, height: 80, patternUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: 'M80 0H0V80', fill: 'none', stroke: 'rgba(30,58,168,0.045)', 'stroke-width': 2 }, fine);
  const major = el('pattern', { id: 'major', width: 400, height: 400, patternUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: 'M400 0H0V400', fill: 'none', stroke: 'rgba(30,58,168,0.075)', 'stroke-width': 2 }, major);
  const fade = el('radialGradient', { id: 'gridfade', cx: '50%', cy: '66%', r: '62%' }, defs);
  el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': 1 }, fade);
  el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': 0 }, fade);
  const mask = el('mask', { id: 'gridmask' }, defs);
  el('rect', { width: W, height: H, fill: 'url(#gridfade)' }, mask);
  const g = el('g', { mask: 'url(#gridmask)' }, svg);
  el('rect', { width: W, height: H, fill: 'url(#fine)' }, g);
  el('rect', { width: W, height: H, fill: 'url(#major)' }, g);

  // Paper tooth.
  const grain = el('filter', { id: 'grain', x: 0, y: 0, width: '100%', height: '100%' }, defs);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.85, numOctaves: 2, seed: 7, stitchTiles: 'stitch' }, grain);
  el('feColorMatrix', { values: '0 0 0 0 0.05  0 0 0 0 0.11  0 0 0 0 0.31  0 0 0 0.03 0' }, grain);
  el('rect', { width: W, height: H, filter: 'url(#grain)' }, svg);

  // Hatch for the one thing that is wrong.
  const hatch = el('pattern', { id: 'hatch', width: 28, height: 28, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 28, stroke: 'rgba(209,75,47,0.5)', 'stroke-width': 6 }, hatch);
  return defs;
}

function label(svg, text, x, y, { size = 40, color = '#e9dcc0', anchor = 'start', spacing = 0.32, opacity = 1, family = 'DM Mono', style = 'normal' } = {}) {
  const t = el('text', {
    x, y, fill: color, 'font-family': family, 'font-size': size, 'font-style': style, 'text-anchor': anchor,
    'letter-spacing': `${spacing}em`, opacity,
  }, svg);
  t.textContent = text;
  return t;
}
