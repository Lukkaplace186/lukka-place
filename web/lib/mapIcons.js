// Speech-bubble price marker icons for PropertyMap.js. Classic
// `google.maps.Marker.icon` data-URI SVGs — not `AdvancedMarkerElement`,
// which needs a Cloud Console Map ID even for a plain pixel-styled pin (see
// PropertyMap.js's doc comment for why this codebase avoids that). Must
// only be called after the Maps JS API has loaded (references the global
// `google.maps.Size`/`Point`, same as the rest of PropertyMap.js).
//
// Shape: a rounded-rect callout with a downward triangle tail, built as one
// unioned SVG path so the stroke traces a continuous outline (no visible
// seam between the body and the tail) — a real vector shape, not the
// previous rounded pill. `anchor` sits at the tail's own tip, so the marker
// points at its coordinate the way a map pin should, rather than floating
// centred over it as the old pill icon did.
//
// Requested a CSS `after:` pseudo-element tail with Tailwind classes — not
// possible here: a `google.maps.Marker.icon` is a flat SVG string handed to
// the Maps JS API, never inserted into the DOM as a real element, so no
// pseudo-element or Tailwind class can ever apply to it. This SVG path is
// the actual mechanism that produces the same visual result.
//
// Colour: normal state is white/ink (matching "custom white speech-bubble
// markers" literally) — the previous per-commune colour hash is dropped
// here on purpose, since the request calls for one plain resting state and
// reserves colour for the active state. Requested "green or royal-blue" for
// the active marker; green isn't in this app's palette (app/globals.css has
// no green token, no green anywhere in Header/FilterBar/badges), so this
// uses --blue-deep, the same royal accent every other "selected/active"
// state in this app already uses (card hover ring, active filter pill,
// underline tab). Flagging the deviation rather than introducing an
// off-palette colour.
const INK_900 = '#0B1120';
const BLUE_DEEP = '#16307E';

// Compact label for pin real estate ("450k $", not "450 000 $") — a
// separate concern from lib/format.js's full formatPrice, which is for
// card/detail-page display where the extra width is available.
function compactPrice(price, purpose) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return '';
  const label = amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(Math.round(amount));
  return purpose === 'rent' ? `${label} $/m` : `${label} $`;
}

/** One unioned outline: rounded-rect body, all four corners, with the
 *  bottom edge cut inward into a downward triangle tail centred on the
 *  body's width. Drawn clockwise from the top-left corner. */
function speechBubblePath({ w, h, r, tailW, tailH }) {
  const apexX = w / 2;
  const apexY = h + tailH;
  return [
    `M ${r},0`,
    `H ${w - r}`,
    `A ${r},${r} 0 0 1 ${w},${r}`,
    `V ${h - r}`,
    `A ${r},${r} 0 0 1 ${w - r},${h}`,
    `L ${apexX + tailW / 2},${h}`,
    `L ${apexX},${apexY}`,
    `L ${apexX - tailW / 2},${h}`,
    `L ${r},${h}`,
    `A ${r},${r} 0 0 1 0,${h - r}`,
    `V ${r}`,
    `A ${r},${r} 0 0 1 ${r},0`,
    'Z',
  ].join(' ');
}

export function buildPricePinIcon({ price, purpose, hovered = false }) {
  const label = compactPrice(price, purpose);
  const scale = hovered ? 1.14 : 1;
  const w = Math.round((Math.max(54, label.length * 7.5 + 34)) * scale);
  const h = Math.round(30 * scale);
  const r = Math.round(9 * scale);
  const tailW = Math.round(14 * scale);
  const tailH = Math.round(9 * scale);
  const fontSize = Math.round(12.5 * scale);
  const strokeWidth = hovered ? 1.75 : 1.5;
  const totalW = w;
  const totalH = h + tailH;

  const fill = hovered ? BLUE_DEEP : '#ffffff';
  const stroke = hovered ? '#ffffff' : INK_900;
  const textFill = hovered ? '#ffffff' : INK_900;

  const path = speechBubblePath({ w, h, r, tailW, tailH });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" />` +
    `<text x="${w / 2}" y="${h / 2 + fontSize * 0.35}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${textFill}" text-anchor="middle">${label}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(totalW, totalH),
    anchor: new google.maps.Point(totalW / 2, totalH),
  };
}
