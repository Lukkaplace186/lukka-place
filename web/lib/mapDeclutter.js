/**
 * Which pins on the /listings map show their price, and which shrink to a dot.
 *
 * Every listing stays on the map at every zoom — clustering ("13" bubbles) was
 * removed on an explicit product direction and this is not a way back to it.
 * What changes is only the label: where two price tags would overlap, the one
 * placed first keeps its price and the other becomes a small dot at its real
 * position, tappable like any pin. Zoom in and the dots get their prices back
 * as room appears. This is the Zillow / Airbnb answer to a dense city view,
 * and it is what turns a stacked blue blob into something readable.
 *
 * Pure: pixel boxes in, a Set of labelled ids out. lib/mapPinLayer.js measures
 * the boxes and calls this on a zoom change or a new set of pins; panning at
 * the same zoom moves every pin by the same amount and cannot change the
 * answer, so it is never recomputed then.
 */

/**
 * Label order: who wins a collision. First in the returned array wins.
 *
 * 1. the pinned pin (hovered card, or the pin whose preview is open) — always
 *    labelled, whatever it overlaps;
 * 2. listings on the list page beside the map, so a card and its pin can be
 *    matched by eye;
 * 3. an exact position before one placed on its commune centroid;
 * 4. then the order the server returned (newest first), which keeps the
 *    answer stable from one render to the next.
 *
 * @param {Array<{id: string, approximate?: boolean}>} pins in server order
 * @param {{pinnedId?: string|null, pageIds?: Set<string>}} [options]
 */
export function orderForLabels(pins, { pinnedId = null, pageIds = new Set() } = {}) {
  const rank = (pin) => {
    if (pinnedId != null && pin.id === String(pinnedId)) return 0;
    if (pageIds.has(pin.id)) return 1;
    return pin.approximate ? 3 : 2;
  };
  return pins
    .map((pin, index) => ({ pin, index, r: rank(pin) }))
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map(({ pin }) => pin);
}

/**
 * Greedy placement on a spatial hash, O(n) for a city's worth of pins.
 *
 * @param {Array<{id: string, x: number, y: number, w: number, h: number}>} pins
 *   centre point and size in pixels, already in label order
 * @param {{gap?: number, cell?: number, always?: string|null}} [options]
 *   `gap` px of air kept between two labels; `always` an id labelled even when
 *   it overlaps something already placed (the pinned pin)
 * @returns {Set<string>} ids that keep their price label
 */
export function declutterPins(pins, { gap = 4, cell = 96, always = null } = {}) {
  const labelled = new Set();
  const grid = new Map();
  const boxes = [];

  const cellsOf = (box) => {
    const keys = [];
    for (let cx = Math.floor(box.left / cell); cx <= Math.floor(box.right / cell); cx += 1) {
      for (let cy = Math.floor(box.top / cell); cy <= Math.floor(box.bottom / cell); cy += 1) {
        keys.push(`${cx}:${cy}`);
      }
    }
    return keys;
  };

  for (const pin of pins) {
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
    const halfW = pin.w / 2 + gap / 2;
    const halfH = pin.h / 2 + gap / 2;
    const box = { left: pin.x - halfW, right: pin.x + halfW, top: pin.y - halfH, bottom: pin.y + halfH };
    const keys = cellsOf(box);

    const forced = always != null && pin.id === String(always);
    let clear = true;
    if (!forced) {
      outer: for (const key of keys) {
        for (const index of grid.get(key) || []) {
          const other = boxes[index];
          if (box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) {
            clear = false;
            break outer;
          }
        }
      }
    }
    if (!clear) continue;

    const index = boxes.push(box) - 1;
    for (const key of keys) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    }
    labelled.add(pin.id);
  }

  return labelled;
}
