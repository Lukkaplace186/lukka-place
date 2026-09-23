// Price-tag marker icons for the detail page's single-listing map
// (components/PropertyMap.js), plus the compact price label every map shares.
// The /listings viewport map no longer uses these SVGs: it draws HTML pills
// through lib/mapPinLayer.js (brand font, CSS transitions, collision dots).
// Classic `google.maps.Marker.icon` data-URI SVGs — not `AdvancedMarkerElement`,
// which needs a Cloud Console Map ID even for a plain pixel-styled pin. Must
// only be called after the Maps JS API has loaded (references the global
// `google.maps.Size`/`Point`).
//
// Shape: a compact rounded tag carrying the price, a short tail whose tip sits
// exactly on the coordinate, a soft drop shadow and a small ground shadow.
//
// Resting tags are WHITE with dark text, the active one (hovered card, or the
// pin whose preview is open) is filled royal blue (2026-09-23, "sleek map"
// pass). The old resting blue fill made a field of 40 tags read as one blue
// mass; the reference portals keep every resting pin quiet and spend the brand
// colour on the one that matters. Same language as the /listings HTML pills.
//
// Tailwind classes cannot reach these: a marker icon is a flat SVG string
// handed to the Maps JS API, never a DOM element.
import { usablePrice } from './format';

const INK = '#0B1120'; // --ink, for the shadows
// The royal ladder, straight out of app/globals.css. Its own comment there
// has already computed the contrast: white text on --blue is 7.9:1, which
// passes AAA, so this is a legitimate fill for text at tag size.
const BLUE = '#1E3AA8'; // --blue (royal-600), the active fill
const BLUE_PRESSED = '#0C1D50'; // --blue-900 — a building's text
const WHITE = '#FFFFFF';
const FONT_STACK = 'Arial, Helvetica, sans-serif';

/**
 * Compact label for pin real estate: "$750", "$1.5k", "$185k", "$1.2M" —
 * the map's own format, separate from lib/format.js's full formatPrice
 * ("1 500 $ / mois") on cards and detail pages where the width exists.
 *
 * Map-only convention, on explicit product direction (2026-09-23, modelled on
 * the reference portals): dollar sign first, a decimal POINT, one decimal
 * only when it carries information ("$1.5k", never "$1.0k" or "$750.00").
 *
 * No "/m": on a map of Kinshasa rents it was the same two characters on every
 * pill. The preview card a tap opens states the full price and period. A
 * YEARLY rent keeps "/an" — it is the exception, and a yearly figure read as
 * monthly is a 12x error.
 *
 * Keeps one decimal between 1 000 and 10 000: rounding to whole thousands
 * printed a real 1 200 $ rent as "1k", a 200 $ understatement on the one
 * number a visitor scans a map for.
 *
 * Guards through usablePrice: `properties.price` is nullable, and Number(null)
 * is 0, so an unguarded label read "$0" on a listing whose price nobody
 * recorded. An unknown price renders no label at all.
 */
export function compactPrice(price, purpose, { pricePeriod = null } = {}) {
  const amount = usablePrice(price);
  if (amount === null) return '';

  const oneDecimal = (value) => String(Math.round(value * 10) / 10);
  let label;
  if (amount < 1000) {
    label = String(Math.round(amount));
  } else if (amount < 9950) {
    label = `${oneDecimal(amount / 1000)}k`;
  } else if (amount < 999500) {
    label = `${Math.round(amount / 1000)}k`;
  } else {
    label = `${oneDecimal(amount / 1_000_000)}M`;
  }

  const money = `$${label}`;
  return purpose === 'rent' && pricePeriod === 'an' ? `${money}/an` : money;
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
 * then the label. Resting pins are white with a hairline ink edge and dark
 * text; the active pin is filled royal blue with white text and a white ring
 * (the ring keeps its edge over the basemap's blue water).
 */
function pinIcon({ label, hovered, restingText }) {
  const g = pricePinGeometry({ label, hovered });
  const fill = hovered ? BLUE : WHITE;
  const stroke = hovered ? WHITE : 'rgba(11,17,32,0.14)';
  const strokeWidth = hovered ? 1.5 : 1;
  const textFill = hovered ? WHITE : restingText;

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
  const label = compactPrice(listing?.price, listing?.purpose, { pricePeriod: listing?.price_period }) || 'N.C.';
  return pinIcon({ label, hovered, restingText: INK });
}

/**
 * The pin for a multi-unit BUILDING — one marker standing for several
 * listings that genuinely share an address.
 *
 * Deliberately not a price tag: a building has a price RANGE, and showing one
 * of its prices on a pin that opens four listings is a small lie. It reads
 * "4 unités · 600$–1500$" instead, in royal-900 text so the two are
 * distinguishable at a glance.
 *
 * @param {string} label   From lib/buildingGroups.js's buildingPinLabel().
 * @param {boolean} [hovered]
 */
export function buildBuildingPinIcon({ label, hovered = false }) {
  return pinIcon({ label: String(label || ''), hovered, restingText: BLUE_PRESSED });
}

/** The label is French prose, not a number — `&` and `<` must not break the SVG. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
