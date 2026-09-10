// Price-tag marker icons for PropertyMap.js. Classic
// `google.maps.Marker.icon` data-URI SVGs — not `AdvancedMarkerElement`,
// which needs a Cloud Console Map ID even for a plain pixel-styled pin (see
// PropertyMap.js's doc comment for why this codebase avoids that). Must
// only be called after the Maps JS API has loaded (references the global
// `google.maps.Size`/`Point`, same as the rest of PropertyMap.js).
//
// Shape: the dense price-tag pattern the reference portals use — a compact
// rounded rectangle carrying the price, with a short tail beneath it. It is
// filled in the brand's royal blue with white text rather than the
// reference portals' white-on-dark-text, on an explicit branding decision:
// the map is the densest single screen on the site, so it is also the
// cheapest place to make the brand colour read at a glance.
// Body and tail are one unioned path so the border traces a
// continuous outline with no seam where the two meet, and `anchor` sits at
// the tail's own tip, so the marker points at its coordinate rather than
// floating centred over it.
//
// The category glyphs and colour coding that used to live here are gone on
// an explicit direction change: a map of 30+ listings reads better as a
// field of scannable prices than as a field of icons, and the price is the
// one value a visitor is actually comparing. lib/mapMarkerKinds.js, the
// cluster bubble builders and the legend they fed were removed with them.
//
// Requested Tailwind classes for this (`text-slate-900 font-bold`,
// `shadow-md border border-slate-200`) — not possible: a
// `google.maps.Marker.icon` is a flat SVG string handed to the Maps JS API,
// never inserted into the DOM as a real element, so no Tailwind class can
// ever apply to it. The SVG attributes below are the actual mechanism that
// produces that same visual result, using this app's own palette values
// (`--blue`, `--blue-900`) rather than Tailwind's slate scale.
import { usablePrice } from './format';

const INK = '#0B1120'; // --ink, only used for the drop shadow now
// The royal ladder, straight out of app/globals.css. Its own comment there
// has already computed the contrast: white text on --blue is 7.9:1, which
// passes AAA, so this is a legitimate fill for text at tag size.
const BLUE = '#1E3AA8'; // --blue (royal-600), the brand fill — resting tag
const BLUE_PRESSED = '#0C1D50'; // --blue-900, the darkest step — active tag
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
 * PropertyMap.js uses for the hovered marker.
 */
export function priceZIndex(price) {
  const amount = usablePrice(price);
  if (amount === null) return 0;
  return Math.min(Math.round(amount), 999000);
}

// One shared soft shadow. SVG element ids are scoped to the document they
// live in, and each of these strings becomes its own <img> document, so
// reusing the same id across every marker is safe.
function dropShadow(id) {
  return (
    `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feDropShadow dx="0" dy="1" stdDeviation="1.3" flood-color="${INK}" flood-opacity="0.26" />` +
    `</filter>`
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
 * layout invariants (the tag fits its own canvas, the anchor sits on the
 * tail tip) are testable without loading the Maps JS API.
 */
export function pricePinGeometry({ label, hovered = false }) {
  const scale = hovered ? 1.1 : 1;
  const text = String(label ?? '');
  // Room for the drop shadow on every side; without it the blur is clipped
  // at the icon's edge and the tag looks like it has a hard grey line.
  const pad = 3;

  const h = Math.round(20 * scale);
  const r = 5 * scale;
  const fontSize = 11.5 * scale;
  const tailW = 8 * scale;
  const tailH = 5 * scale;
  const w = Math.round(Math.max(34, text.length * 6.6 + 16) * scale);

  const width = Math.round(w + pad * 2);
  const height = Math.round(pad + h + tailH + pad);
  const x = (width - w) / 2;
  const y = pad;
  const tipY = y + h + tailH;

  return { scale, pad, w, h, r, tailW, tailH, fontSize, width, height, x, y, tipY, cx: width / 2 };
}

/**
 * The price tag for one listing.
 *
 * @param {object} listing - the listing itself, so the label can never be
 *   built from a different record than the marker it belongs to.
 * @param {boolean} [hovered] - the hover/active treatment: the darkest step
 *   of the royal ladder, a fuller white ring, scaled up slightly.
 */
export function buildPricePinIcon({ listing, hovered = false }) {
  // "N.C." (non communiqué) rather than an empty tag. compactPrice returns
  // '' for a listing with no usable price, and a blank white pill on the map
  // is meaningless noise — it neither states a price nor admits it is
  // missing. This is not theoretical: 1 of the 36 currently approved
  // listings has no price. The standard French listing abbreviation says the
  // true thing in the two characters a tag has room for.
  const label = compactPrice(listing?.price, listing?.purpose) || 'N.C.';
  const g = pricePinGeometry({ label, hovered });

  // Resting is --blue; active steps to --blue-900 rather than the ladder's
  // usual --blue-deep hover. --blue-deep sits one step from --blue and the
  // difference is invisible on a 40px tag — and this state is not decoration,
  // it is the map half of the card<->map hover sync, so it has to be obvious
  // at a glance. The white ring thickens with it for the same reason.
  //
  // The ring itself is not optional: a blue tag over the basemap's blue water
  // (lib/mapStyle.js's --water) has almost no edge without it.
  const fill = hovered ? BLUE_PRESSED : BLUE;
  const stroke = hovered ? WHITE : 'rgba(255,255,255,0.92)';
  const strokeWidth = hovered ? 1.75 : 1.25;
  const textFill = WHITE;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">` +
    `<defs>${dropShadow('lkp-tag-shadow')}</defs>` +
    `<path d="${pillPath({ x: g.x, y: g.y, w: g.w, h: g.h, r: g.r, tailW: g.tailW, tailH: g.tailH })}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" filter="url(#lkp-tag-shadow)" />` +
    `<text x="${g.cx.toFixed(2)}" y="${(g.y + g.h / 2 + g.fontSize * 0.36).toFixed(2)}" ` +
    `font-family="${FONT_STACK}" font-size="${g.fontSize.toFixed(2)}" font-weight="700" ` +
    `fill="${textFill}" text-anchor="middle">${label}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.tipY),
  };
}

/**
 * The pin for a multi-unit BUILDING — one marker standing for several
 * listings that genuinely share an address.
 *
 * Deliberately not a price tag: a building has a price RANGE, and showing one
 * of its prices on a pin that opens four listings is a small lie. It reads
 * "4 unités · 600$–1500$" instead, and is drawn darker and wider than a price
 * tag so the two are distinguishable at a glance on a crowded map.
 *
 * @param {string} label   From lib/buildingGroups.js's buildingPinLabel().
 * @param {boolean} [hovered]
 */
export function buildBuildingPinIcon({ label, hovered = false }) {
  const text = String(label || '');
  const g = pricePinGeometry({ label: text, hovered });

  // One step darker than a price tag at rest, so a building never reads as
  // just another (unusually wide) price.
  const fill = hovered ? BLUE_PRESSED : BLUE_PRESSED;
  const stroke = hovered ? WHITE : 'rgba(255,255,255,0.92)';
  const strokeWidth = hovered ? 1.75 : 1.25;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">` +
    `<defs>${dropShadow('lkp-bld-shadow')}</defs>` +
    `<path d="${pillPath({ x: g.x, y: g.y, w: g.w, h: g.h, r: g.r, tailW: g.tailW, tailH: g.tailH })}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" filter="url(#lkp-bld-shadow)" />` +
    `<text x="${g.cx.toFixed(2)}" y="${(g.y + g.h / 2 + g.fontSize * 0.36).toFixed(2)}" ` +
    `font-family="${FONT_STACK}" font-size="${g.fontSize.toFixed(2)}" font-weight="700" ` +
    `fill="${WHITE}" text-anchor="middle">${escapeXml(text)}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.tipY),
  };
}

/** The label is French prose, not a number — `&` and `<` must not break the SVG. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
