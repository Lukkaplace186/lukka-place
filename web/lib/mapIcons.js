// Price-tag marker icons for the maps (components/ListingsMap.js on /listings,
// components/PropertyMap.js on the detail page). Classic
// `google.maps.Marker.icon` data-URI SVGs — not `AdvancedMarkerElement`,
// which needs a Cloud Console Map ID even for a plain pixel-styled pin. Must
// only be called after the Maps JS API has loaded (references the global
// `google.maps.Size`/`Point`).
//
// Shape: the grounded price pin the reference portals use (Booking.com is the
// one this was matched to) — a compact rounded rectangle carrying the price,
// a short tail beneath it whose tip sits exactly on the coordinate, and three
// layers of depth that make it read as standing ON the map rather than
// floating over it:
//   1. a soft drop shadow under the tag and its tail;
//   2. a small blurred ground shadow — an ellipse centred on the tail tip —
//      the "landing" spot where the pin meets the land;
//   3. an active state (hovered card, or the pin whose preview is open) that
//      flips to white with dark text and a thick blue border, so the one pin
//      that matters stands out of a field of blue ones.
//
// Filled in the brand's royal blue with white text rather than Booking's
// navy, on an explicit branding decision: the map is the densest single
// screen on the site, so it is also the cheapest place to make the brand
// colour read at a glance. Body and tail are one unioned path so the border
// traces a continuous outline with no seam where the two meet.
//
// The category glyphs and colour coding that used to live here are gone on
// an explicit direction change: a map of 30+ listings reads better as a
// field of scannable prices than as a field of icons, and the price is the
// one value a visitor is actually comparing. lib/mapMarkerKinds.js, the
// cluster bubble builders and the legend they fed were removed with them.
// (Clustering briefly returned with the viewport map on 2026-09-14 and was
// removed again the same day, for the same reason: every listing is a price.)
//
// Tailwind classes (`shadow-md`, `border-blue-600`) cannot reach these: a
// marker icon is a flat SVG string handed to the Maps JS API, never a DOM
// element. The SVG attributes and filters below are the real mechanism, using
// this app's own palette values.
import { usablePrice } from './format';

const INK = '#0B1120'; // --ink, for the shadows
// The royal ladder, straight out of app/globals.css. Its own comment there
// has already computed the contrast: white text on --blue is 7.9:1, which
// passes AAA, so this is a legitimate fill for text at tag size.
const BLUE = '#1E3AA8'; // --blue (royal-600), the brand fill — resting tag
const BLUE_PRESSED = '#0C1D50'; // --blue-900 — a resting building, and active text
const WHITE = '#FFFFFF';
const FONT_STACK = 'Arial, Helvetica, sans-serif';

/**
 * Compact label for pin real estate ("185k $", not "185 000 $") — a separate
 * concern from lib/format.js's full formatPrice, which is for card/detail-
 * page display where the extra width is available.
 *
 * Keeps one decimal between 1 000 and 10 000. Rounding straight to whole
 * thousands there printed a real 1 200 $/mois rent as "1k $/m" — a 200 $
 * understatement on the single number a visitor scans a map for, and it
 * collapsed the entire mid-market rent band (1 000-1 499) onto one label.
 *
 * Currency sits AFTER the amount with a decimal comma, and — unlike
 * everywhere else in this app — with NO space before it: "1,2k$/m", not
 * "1,2k $/m". That is a deliberate, map-only exception to the French
 * spacing lib/format.js uses on cards and detail pages. A tag is ~40px of
 * map real estate that has to stay readable in a crowded field, and the
 * thin space is the cheapest character to spend. The order (amount, then
 * currency) still matches the rest of the app, so the tag and the card
 * beside it still read as the same price.
 *
 * Guards through usablePrice for the same reason every other price render
 * does: `properties.price` is nullable, and Number(null) is 0, so an
 * unguarded pin label read "0 $/m" — a real price claim — on a listing whose
 * price nobody recorded. An unknown price renders no label at all; the pin
 * still plots, because its position is real either way.
 */
export function compactPrice(price, purpose) {
  const amount = usablePrice(price);
  if (amount === null) return '';

  let label;
  if (amount < 1000) {
    label = String(Math.round(amount));
  } else if (amount < 10000) {
    const tenths = Math.round(amount / 100) / 10;
    label = `${String(tenths).replace('.', ',')}k`;
  } else {
    label = `${Math.round(amount / 1000)}k`;
  }

  return purpose === 'rent' ? `${label}$/m` : `${label}$`;
}

/**
 * Stacking order. "Higher prices to the front" as directed, so that where
 * two tags do overlap the more expensive listing stays readable, and a
 * hovered tag beats every resting one.
 *
 * Clamped below google.maps.Marker.MAX_ZINDEX (1000000) so a sale price in
 * the hundreds of thousands can never collide with, or exceed, the value
 * the maps use for the hovered/selected marker.
 */
export function priceZIndex(price) {
  const amount = usablePrice(price);
  if (amount === null) return 0;
  return Math.min(Math.round(amount), 999000);
}

/**
 * The two shadow filters. SVG element ids are scoped to the document they
 * live in, and each of these strings becomes its own <img> document, so
 * reusing the same ids across every marker is safe.
 *
 * The drop shadow is a touch deeper than a flat UI card's (dy 2, blur 2.2,
 * 32%): at map scale, against a busy basemap, anything softer disappears.
 */
function shadowDefs() {
  return (
    `<defs>` +
    `<filter id="lkp-pin-drop" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="${INK}" flood-opacity="0.32" />` +
    `</filter>` +
    `<filter id="lkp-pin-ground" x="-100%" y="-200%" width="300%" height="500%">` +
    `<feGaussianBlur stdDeviation="1.3" />` +
    `</filter>` +
    `</defs>`
  );
}

/**
 * One unioned outline: a rounded rectangle whose bottom edge is cut inward
 * into a short downward tail, centred on the body's width. Drawn clockwise
 * from the top-left corner, so a single stroke traces body and tail as one
 * continuous border.
 */
function pillPath({ x, y, w, h, r, tailW, tailH }) {
  const apexX = x + w / 2;
  const apexY = y + h + tailH;
  const right = x + w;
  const bottom = y + h;
  return [
    `M ${(x + r).toFixed(2)},${y.toFixed(2)}`,
    `H ${(right - r).toFixed(2)}`,
    `A ${r.toFixed(2)},${r.toFixed(2)} 0 0 1 ${right.toFixed(2)},${(y + r).toFixed(2)}`,
    `V ${(bottom - r).toFixed(2)}`,
    `A ${r.toFixed(2)},${r.toFixed(2)} 0 0 1 ${(right - r).toFixed(2)},${bottom.toFixed(2)}`,
    `L ${(apexX + tailW / 2).toFixed(2)},${bottom.toFixed(2)}`,
    `L ${apexX.toFixed(2)},${apexY.toFixed(2)}`,
    `L ${(apexX - tailW / 2).toFixed(2)},${bottom.toFixed(2)}`,
    `L ${(x + r).toFixed(2)},${bottom.toFixed(2)}`,
    `A ${r.toFixed(2)},${r.toFixed(2)} 0 0 1 ${x.toFixed(2)},${(bottom - r).toFixed(2)}`,
    `V ${(y + r).toFixed(2)}`,
    `A ${r.toFixed(2)},${r.toFixed(2)} 0 0 1 ${(x + r).toFixed(2)},${y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/**
 * Geometry for one price tag, in pixels. Pure — no Maps globals — so the
 * layout invariants (the tag and its ground shadow fit their own canvas, the
 * anchor sits on the tail tip) are testable without loading the Maps JS API.
 */
export function pricePinGeometry({ label, hovered = false }) {
  const scale = hovered ? 1.1 : 1;
  const text = String(label ?? '');
  // Room for the drop shadow's blur on every side; without it the blur is
  // clipped at the icon's edge and the tag looks like it has a hard grey line.
  const pad = 4;

  const h = Math.round(20 * scale);
  const r = 5 * scale;
  const fontSize = 11.5 * scale;
  const tailW = 9 * scale;
  const tailH = 6 * scale;
  const w = Math.round(Math.max(34, text.length * 6.6 + 16) * scale);

  // The ground shadow: a flat ellipse centred on the tail tip, so it lands
  // exactly where the pin points. The canvas extends below the tip far
  // enough to hold it and its blur.
  const groundRx = 7 * scale;
  const groundRy = 2.4 * scale;
  const bottomPad = Math.ceil(groundRy + 4);

  const width = Math.round(Math.max(w + pad * 2, groundRx * 2 + 8));
  const x = (width - w) / 2;
  const y = pad;
  const tipY = y + h + tailH;
  const height = Math.round(tipY + bottomPad);

  return { scale, pad, w, h, r, tailW, tailH, fontSize, width, height, x, y, tipY, cx: width / 2, groundRx, groundRy };
}

/**
 * The shared pin drawing: ground shadow, then the tag with its drop shadow,
 * then the label. Resting pins are a solid fill with a thin white ring (the
 * ring is not optional: a blue tag over the basemap's blue water has almost
 * no edge without it); the active pin is white with a thick blue border and
 * dark text.
 */
function pinIcon({ label, hovered, restingFill }) {
  const g = pricePinGeometry({ label, hovered });
  const fill = hovered ? WHITE : restingFill;
  const stroke = hovered ? BLUE : 'rgba(255,255,255,0.92)';
  const strokeWidth = hovered ? 2.2 : 1.25;
  const textFill = hovered ? BLUE_PRESSED : WHITE;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">` +
    shadowDefs() +
    `<ellipse cx="${g.cx.toFixed(2)}" cy="${g.tipY.toFixed(2)}" rx="${g.groundRx.toFixed(2)}" ry="${g.groundRy.toFixed(2)}" ` +
    `fill="${INK}" fill-opacity="${hovered ? 0.4 : 0.3}" filter="url(#lkp-pin-ground)" />` +
    `<path d="${pillPath({ x: g.x, y: g.y, w: g.w, h: g.h, r: g.r, tailW: g.tailW, tailH: g.tailH })}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" filter="url(#lkp-pin-drop)" />` +
    `<text x="${g.cx.toFixed(2)}" y="${(g.y + g.h / 2 + g.fontSize * 0.36).toFixed(2)}" ` +
    `font-family="${FONT_STACK}" font-size="${g.fontSize.toFixed(2)}" font-weight="700" ` +
    `fill="${textFill}" text-anchor="middle">${escapeXml(label)}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(g.width, g.height),
    // The tail tip — and the centre of the ground shadow — is the coordinate.
    anchor: new google.maps.Point(g.cx, g.tipY),
  };
}

/**
 * The price tag for one listing.
 *
 * @param {object} listing - the listing itself, so the label can never be
 *   built from a different record than the marker it belongs to.
 * @param {boolean} [hovered] - the active treatment (hovered card, or the pin
 *   whose preview is open): white, blue border, dark text, scaled up slightly.
 */
export function buildPricePinIcon({ listing, hovered = false }) {
  // "N.C." (non communiqué) rather than an empty tag. compactPrice returns
  // '' for a listing with no usable price, and a blank pill on the map is
  // meaningless noise — it neither states a price nor admits it is missing.
  const label = compactPrice(listing?.price, listing?.purpose) || 'N.C.';
  return pinIcon({ label, hovered, restingFill: BLUE });
}

/**
 * The pin for a multi-unit BUILDING — one marker standing for several
 * listings that genuinely share an address.
 *
 * Deliberately not a price tag: a building has a price RANGE, and showing one
 * of its prices on a pin that opens four listings is a small lie. It reads
 * "4 unités · 600$–1500$" instead, and rests one step darker than a price tag
 * so the two are distinguishable at a glance on a crowded map.
 *
 * @param {string} label   From lib/buildingGroups.js's buildingPinLabel().
 * @param {boolean} [hovered]
 */
export function buildBuildingPinIcon({ label, hovered = false }) {
  return pinIcon({ label: String(label || ''), hovered, restingFill: BLUE_PRESSED });
}

/** The label is French prose, not a number — `&` and `<` must not break the SVG. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
