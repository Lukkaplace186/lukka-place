// Zillow-style rounded price-pill marker icons for PropertyMap.js. Classic
// `google.maps.Marker.icon` data-URI SVGs — not `AdvancedMarkerElement`,
// which needs a Cloud Console Map ID even for a plain pixel-styled pin (see
// PropertyMap.js's doc comment for why this codebase avoids that). Must
// only be called after the Maps JS API has loaded (references the global
// `google.maps.Size`/`Point`, same as the rest of PropertyMap.js).

// A small fixed blue/slate family, mirroring --blue / --blue-deep / --ink
// in app/globals.css — commune color is a deterministic hash into this
// palette, a lightweight visual grouping cue. Hardcoded rather than read
// from a CSS custom property on purpose: these are baked into data-URI SVG
// strings at runtime, where the document's stylesheet is unreachable. All
// six stay dark enough for white pin-label text to keep real contrast
// (checked against WCAG's 4.5:1 text-contrast guidance, not just picked by
// eye). Not a substitute for real commune boundary polygons, which don't
// exist anywhere in this repo (see web/CLAUDE.md's "no fabricated data"
// rule) — just a color hint.
const PIN_COLORS = ['#1450D0', '#1040A6', '#2563EB', '#0F172A', '#1E3A8A', '#334155'];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function communeColor(commune) {
  if (!commune) return PIN_COLORS[0];
  return PIN_COLORS[hashString(commune) % PIN_COLORS.length];
}

// Compact label for pin real estate ("450k $", not "450 000 $") — a
// separate concern from lib/format.js's full formatPrice, which is for
// card/detail-page display where the extra width is available.
function compactPrice(price, purpose) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return '';
  const label = amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(Math.round(amount));
  return purpose === 'rent' ? `${label} $/m` : `${label} $`;
}

export function buildPricePinIcon({ price, purpose, commune, hovered = false }) {
  const label = compactPrice(price, purpose);
  const color = communeColor(commune);
  const scale = hovered ? 1.18 : 1;
  const width = Math.round((Math.max(46, label.length * 7.5 + 28)) * scale);
  const height = Math.round(28 * scale);
  const fontSize = Math.round(12 * scale);
  const strokeWidth = hovered ? 3 : 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${width - strokeWidth}" height="${height - strokeWidth}" rx="${height / 2}" fill="${color}" stroke="#ffffff" stroke-width="${strokeWidth}" />` +
    `<text x="${width / 2}" y="${height / 2 + fontSize * 0.35}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" text-anchor="middle">${label}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(width, height),
    anchor: new google.maps.Point(width / 2, height / 2),
  };
}
