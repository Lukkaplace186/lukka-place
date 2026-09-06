// Marker and cluster icons for PropertyMap.js. Classic
// `google.maps.Marker.icon` data-URI SVGs — not `AdvancedMarkerElement`,
// which needs a Cloud Console Map ID even for a plain pixel-styled pin (see
// PropertyMap.js's doc comment for why this codebase avoids that). Must
// only be called after the Maps JS API has loaded (references the global
// `google.maps.Size`/`Point`, same as the rest of PropertyMap.js).
//
// Shape: a white price label stacked directly ABOVE a solid, colour-coded
// circular icon pin with a downward tail, both drawn into one SVG so they
// travel as a single marker and can never drift apart or overlap. `anchor`
// sits at the tail's own tip, so the marker points at its coordinate the
// way a map pin should rather than floating centred over it — the same
// anchor precision the previous single speech-bubble icon had, deliberately
// preserved through the redesign.
//
// The pin's colour and glyph come from lib/mapMarkerKinds.js and encode the
// listing's real property type; the price stays in a high-contrast white
// label because it is the one value a visitor scans for, and a coloured
// fill behind it would cost legibility for no information gain.
//
// Requested a CSS `after:` pseudo-element tail with Tailwind classes — not
// possible here: a `google.maps.Marker.icon` is a flat SVG string handed to
// the Maps JS API, never inserted into the DOM as a real element, so no
// pseudo-element or Tailwind class can ever apply to it. These SVG paths
// are the actual mechanism that produces the same visual result.
import { resolveMarkerKind, UNKNOWN_KIND } from './mapMarkerKinds';
import { usablePrice } from './format';

const INK_900 = '#0B1120';
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
 * Decimal comma, like every other number this app renders in French.
 *
 * Guards through lib/format.js's usablePrice for the same reason every other
 * price render does: `properties.price` is nullable, and Number(null) is 0,
 * so an unguarded pin label read "0 $/m" — a real price claim — on a listing
 * whose price nobody recorded. An unknown price renders no label at all;
 * the pin still plots, because its position is real either way.
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

  return purpose === 'rent' ? `${label} $/m` : `${label} $`;
}

// One shared soft shadow. SVG element ids are scoped to the document they
// live in, and each of these strings becomes its own <img> document, so
// reusing the same id across every marker is safe.
function dropShadow(id, { dy = 1, blur = 1.4, opacity = 0.3 } = {}) {
  return (
    `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="${INK_900}" flood-opacity="${opacity}" />` +
    `</filter>`
  );
}

/** A lucide 24x24 stroke glyph, scaled and centred on (cx, cy). */
function glyphMarkup(paths, { cx, cy, size, stroke, strokeWidth }) {
  const scale = size / 24;
  const inner = paths.map((d) => `<path d="${d}" />`).join('');
  return (
    `<g transform="translate(${(cx - size / 2).toFixed(2)} ${(cy - size / 2).toFixed(2)}) scale(${scale.toFixed(4)})" ` +
    `fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`
  );
}

/** Circle of radius r centred on (cx, cy) with a downward triangular tail,
 *  as one continuous outline so the white ring traces the whole shape with
 *  no seam. `tailW` is the width of the tail where it meets the circle. */
function teardropPath({ cx, cy, r, tailW, tailH }) {
  const halfTail = tailW / 2;
  const baseY = cy + Math.sqrt(Math.max(r * r - halfTail * halfTail, 0));
  const tipY = cy + r + tailH;
  return [
    `M ${(cx - halfTail).toFixed(2)},${baseY.toFixed(2)}`,
    `A ${r.toFixed(2)},${r.toFixed(2)} 0 1 1 ${(cx + halfTail).toFixed(2)},${baseY.toFixed(2)}`,
    `L ${cx.toFixed(2)},${tipY.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function svgDataUri(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Geometry for one listing marker, in pixels. Pure — no Maps globals — so
 * the layout invariants (label clears the pin, anchor sits on the tail tip)
 * are testable without loading the Maps JS API.
 */
export function pricePinGeometry({ label, hovered = false }) {
  const scale = hovered ? 1.12 : 1;
  const pad = 3;
  // A listing with no usable price gets no label band at all, rather than an
  // empty white pill or a pin floating below a blank gap — see compactPrice.
  const hasLabel = String(label ?? '').length > 0;
  const labelH = hasLabel ? Math.round(21 * scale) : 0;
  const gap = hasLabel ? Math.round(3 * scale) : 0;
  const pinR = 13 * scale;
  const tailH = 6 * scale;

  const labelW = hasLabel ? Math.round(Math.max(46, label.length * 6.9 + 20) * scale) : 0;
  const width = Math.round(Math.max(labelW, pinR * 2 + 2) + pad * 2);
  const cx = width / 2;
  const pinCy = pad + labelH + gap + pinR;
  const tipY = pinCy + pinR + tailH;

  return {
    scale,
    pad,
    labelH,
    labelR: Math.round(6 * scale),
    labelW,
    fontSize: 11.5 * scale,
    pinR,
    tailH,
    tailW: 10 * scale,
    glyphSize: 15 * scale,
    width,
    height: Math.round(tipY + pad),
    cx,
    pinCy,
    tipY,
  };
}

/**
 * The full marker for one listing: white price label above, colour-coded
 * icon pin below, anchored at the pin's tip.
 *
 * @param {object} listing - the listing itself, so the pin's type colour and
 *   the price label can never be built from two different records.
 * @param {boolean} [hovered] - the hover/active treatment (scaled up, darker
 *   fill, label outlined in the type colour).
 */
export function buildPricePinIcon({ listing, hovered = false }) {
  const kind = resolveMarkerKind(listing);
  const label = compactPrice(listing?.price, listing?.purpose);
  const g = pricePinGeometry({ label, hovered });

  const pinFill = hovered ? kind.colorDark : kind.color;
  const labelStroke = hovered ? kind.color : 'rgba(11,17,32,0.14)';
  const labelStrokeWidth = hovered ? 1.5 : 1;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">` +
    `<defs>${dropShadow('lkp-pin-shadow')}</defs>` +
    `<g filter="url(#lkp-pin-shadow)">` +
    // Pin first, so the label's white body always wins the overlap if a
    // future size change ever makes the two touch.
    `<path d="${teardropPath({ cx: g.cx, cy: g.pinCy, r: g.pinR, tailW: g.tailW, tailH: g.tailH })}" ` +
    `fill="${pinFill}" stroke="#FFFFFF" stroke-width="${(2 * g.scale).toFixed(2)}" stroke-linejoin="round" />` +
    (label
      ? `<rect x="${(g.cx - g.labelW / 2).toFixed(2)}" y="${g.pad}" width="${g.labelW}" height="${g.labelH}" ` +
        `rx="${g.labelR}" fill="#FFFFFF" stroke="${labelStroke}" stroke-width="${labelStrokeWidth}" />`
      : '') +
    `</g>` +
    glyphMarkup(kind.glyph, {
      cx: g.cx,
      cy: g.pinCy,
      size: g.glyphSize,
      stroke: '#FFFFFF',
      strokeWidth: 2.4,
    }) +
    (label
      ? `<text x="${g.cx.toFixed(2)}" y="${(g.pad + g.labelH / 2 + g.fontSize * 0.36).toFixed(2)}" ` +
        `font-family="${FONT_STACK}" font-size="${g.fontSize.toFixed(2)}" font-weight="700" ` +
        `fill="${INK_900}" text-anchor="middle">${label}</text>`
      : '') +
    `</svg>`;

  return {
    url: svgDataUri(svg),
    scaledSize: new google.maps.Size(g.width, g.height),
    anchor: new google.maps.Point(g.cx, g.tipY),
  };
}

/**
 * Tally the marker kinds inside one cluster.
 *
 * Reads the `lukkaKind` property PropertyMap.js stamps onto each
 * google.maps.Marker at creation. Exported separately from
 * buildClusterIcon so the tally is testable without the Maps JS globals the
 * icon builder needs.
 */
export function tallyClusterKinds(markers) {
  const counts = {};
  for (const marker of markers ?? []) {
    const kind = marker?.lukkaKind ?? UNKNOWN_KIND;
    if (!counts[kind.key]) counts[kind.key] = { kind, count: 0 };
    counts[kind.key].count += 1;
  }
  return counts;
}

/**
 * Ring segments for a cluster, as {kind, count, drawn, offset} in pixels of
 * arc. Pure, for the same reason pricePinGeometry is: the proportionality
 * of the ring is the whole point of it and deserves a real test.
 */
export function clusterRingSegments({ counts, radius, gapLen }) {
  const entries = Object.values(counts)
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  const sum = entries.reduce((acc, entry) => acc + entry.count, 0) || 1;
  const circumference = 2 * Math.PI * radius;
  // A visible break between arcs only when there is more than one type; a
  // single-type ring stays an unbroken circle.
  const gap = entries.length > 1 ? gapLen : 0;

  let offset = 0;
  const segments = entries.map((entry) => {
    const arc = (entry.count / sum) * circumference;
    const segment = { kind: entry.kind, count: entry.count, drawn: Math.max(arc - gap, 0.5), offset };
    offset += arc;
    return segment;
  });

  return { segments, circumference };
}

/**
 * A cluster bubble: white disc, count in ink, wrapped in a ring split into
 * one arc per property type present, sized by how many of each the cluster
 * holds. The ring is the honest answer to "what is under this number" — a
 * cluster of eight flats reads as one solid blue ring, a genuinely mixed
 * area reads as a segmented one, and neither requires zooming in to find
 * out.
 */
export function buildClusterIcon({ counts, total }) {
  // Grows with the cluster but flattens fast — a 40-property cluster must
  // not become a disc that swallows its own neighbourhood.
  const r = 17 + Math.min(Math.log2(Math.max(total, 1)) * 2.6, 11);
  const ringWidth = 4;
  const ringR = r - ringWidth / 2;
  const pad = 4;
  const size = Math.round((r + pad) * 2);
  const c = size / 2;

  const { segments, circumference } = clusterRingSegments({
    counts,
    radius: ringR,
    gapLen: Math.min(2 * Math.PI * ringR * 0.02, 3),
  });

  const ring = segments
    .map(
      (segment) =>
        `<circle cx="${c}" cy="${c}" r="${ringR.toFixed(2)}" fill="none" stroke="${segment.kind.color}" ` +
        `stroke-width="${ringWidth}" stroke-linecap="butt" ` +
        `stroke-dasharray="${segment.drawn.toFixed(2)} ${(circumference - segment.drawn).toFixed(2)}" ` +
        `stroke-dashoffset="${(-segment.offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})" />`,
    )
    .join('');

  const fontSize = total >= 100 ? r * 0.66 : r * 0.78;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs>${dropShadow('lkp-cluster-shadow', { dy: 1, blur: 2, opacity: 0.22 })}</defs>` +
    `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="#FFFFFF" filter="url(#lkp-cluster-shadow)" />` +
    ring +
    `<text x="${c}" y="${(c + fontSize * 0.35).toFixed(2)}" font-family="${FONT_STACK}" ` +
    `font-size="${fontSize.toFixed(2)}" font-weight="700" fill="${INK_900}" text-anchor="middle">${total}</text>` +
    `</svg>`;

  return {
    url: svgDataUri(svg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(c, c),
  };
}

/**
 * MarkerClusterer's `renderer` contract: one google.maps.Marker per cluster.
 * Defined here rather than inline in PropertyMap.js so the whole visual
 * vocabulary of the map — pins and clusters — lives in one file.
 */
export function createClusterRenderer() {
  return {
    render({ count, position, markers }) {
      return new google.maps.Marker({
        position,
        icon: buildClusterIcon({ counts: tallyClusterKinds(markers), total: count }),
        // Above every price pin, and higher for bigger clusters, so a large
        // cluster is never hidden behind a small one it overlaps.
        zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
        title: `${count} biens`,
      });
    },
  };
}
