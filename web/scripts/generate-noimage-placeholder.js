// One-off generator for public/assets/img/noimage.jpg — the static asset
// NO_PHOTO_URL (lib/constants.js, kept byte-identical to
// lukka-place-engine/services/postgres.js's own copy) has always pointed
// at, but which was never actually created, so every listing with no real
// photo (featured_image stored as this exact URL by the engine) rendered a
// blank/broken image on the storefront instead of an honest placeholder.
// Pure vector shapes only — no text — so this doesn't depend on any font
// being present in whatever environment runs this script.
const sharp = require('sharp');
const path = require('path');

const WIDTH = 1200;
const HEIGHT = 800;

// Design tokens (web/app/globals.css) — mist background, ink-300 glyph,
// matching PhotoGallery.js's own empty-state treatment (ImageOff icon,
// canvas-alt/ink-25 tones) so a photo-less card reads as the same honest
// "no photo" state used elsewhere on the site, not a fabricated stand-in.
const MIST = '#EFF1F6';
const INK_300 = '#98A1B5';

const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const iconSize = 220;
const half = iconSize / 2;
const stroke = 10;

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${MIST}"/>
  <g transform="translate(${cx - half}, ${cy - half})" stroke="${INK_300}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <rect x="0" y="0" width="${iconSize}" height="${iconSize}" rx="24"/>
    <circle cx="${iconSize * 0.32}" cy="${iconSize * 0.34}" r="${iconSize * 0.09}"/>
    <path d="M0 ${iconSize * 0.72} L${iconSize * 0.34} ${iconSize * 0.42} L${iconSize * 0.6} ${iconSize * 0.64} L${iconSize * 0.78} ${iconSize * 0.5} L${iconSize} ${iconSize * 0.7}" />
    <line x1="${iconSize * 0.08}" y1="${iconSize * 0.08}" x2="${iconSize * 0.92}" y2="${iconSize * 0.92}" stroke-width="${stroke * 0.85}"/>
  </g>
</svg>`;

const outPath = path.join(__dirname, '..', 'public', 'assets', 'img', 'noimage.jpg');

sharp(Buffer.from(svg))
  .jpeg({ quality: 82 })
  .toFile(outPath)
  .then(() => console.log('wrote', outPath))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
