/**
 * A camera "flight" between two places on the /listings map — St Luc to
 * Bandal pulls back to show the city, glides across it, and settles on the
 * new place, instead of blinking out and back in.
 *
 * Why it is choreographed by hand: the map uses Google's classic raster
 * renderer (the JSON basemap style, no Map ID), where `moveCamera` cannot
 * animate and `setCenter` jumps. What raster DOES animate is a `panTo` whose
 * distance fits on screen, and a one-step `setZoom`. So the flight is:
 *
 *   1. zoom OUT one level at a time until both places fit in the view
 *      (never past FLY_MIN_ZOOM — the whole city, not the province);
 *   2. `panTo` the destination — now a short, animated glide;
 *   3. zoom IN one level at a time to the destination's zoom.
 *
 * Each step waits for the map's `idle` (with a timeout, since `idle` can be
 * swallowed by a hidden tab). A newer flight cancels an older one mid-air.
 * Reduced-motion visitors, and a hop short enough to be a plain pan, skip
 * the ceremony.
 */

export const FLY_MIN_ZOOM = 11;
const STEP_TIMEOUT_MS = 1200;
/** Both ends must fit inside this share of the smaller viewport side. */
const FIT_SHARE = 0.7;

let currentFlight = 0;

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** World-pixel distance between two points at `zoom` (Web Mercator, 256px tiles). */
export function pixelDistance(a, b, zoom) {
  const project = ({ lat, lng }) => {
    const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
    return {
      x: 256 * (0.5 + lng / 360),
      y: 256 * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
    };
  };
  const pa = project(a);
  const pb = project(b);
  const scale = 2 ** zoom;
  return Math.hypot((pa.x - pb.x) * scale, (pa.y - pb.y) * scale);
}

/**
 * The zoom the flight travels at: the deepest zoom, no deeper than where it
 * starts or lands, at which both points fit inside FIT_SHARE of the viewport.
 */
export function cruiseZoom(from, to, { fromZoom, toZoom, viewportPx }) {
  let zoom = Math.min(fromZoom, toZoom);
  while (zoom > FLY_MIN_ZOOM && pixelDistance(from, to, zoom) > viewportPx * FIT_SHARE) zoom -= 1;
  return zoom;
}

/**
 * Run one camera step and wait until it has really finished: the `idle` that
 * follows the step's own movement event, not one left over from the step
 * before. Waiting on the first `idle` was the bug in the first version — it
 * resolved at once, the zoom-in started while the glide was still under way,
 * and the map dropped back in over the old place before moving.
 */
function step(map, flight, movedEvent, run) {
  return new Promise((resolve) => {
    let idleListener = null;
    const finish = () => {
      clearTimeout(timer);
      movedListener.remove();
      idleListener?.remove();
      resolve();
    };
    const movedListener = google.maps.event.addListenerOnce(map, movedEvent, () => {
      idleListener = google.maps.event.addListenerOnce(map, 'idle', finish);
    });
    const timer = setTimeout(finish, STEP_TIMEOUT_MS);
    run();
  }).then(() => flight === currentFlight);
}

/**
 * Fly the map to `{ center, zoom }`. Resolves true when it landed, false when
 * a newer flight took over.
 */
export async function flyTo(map, { center, zoom }) {
  const flight = ++currentFlight;
  const start = map.getCenter();
  const startZoom = map.getZoom();
  const div = map.getDiv();
  const viewportPx = Math.min(div?.clientWidth || 360, div?.clientHeight || 360);

  if (!start || !Number.isFinite(startZoom) || prefersReducedMotion()) {
    map.setCenter(center);
    map.setZoom(zoom);
    return true;
  }

  const from = { lat: start.lat(), lng: start.lng() };
  const cruise = cruiseZoom(from, center, { fromZoom: startZoom, toZoom: zoom, viewportPx });

  for (let z = startZoom - 1; z >= cruise; z -= 1) {
    if (!(await step(map, flight, 'zoom_changed', () => map.setZoom(z)))) return false;
  }
  if (!(await step(map, flight, 'center_changed', () => map.panTo(center)))) return false;
  for (let z = Math.max(cruise, map.getZoom()) + 1; z <= zoom; z += 1) {
    if (!(await step(map, flight, 'zoom_changed', () => map.setZoom(z)))) return false;
  }
  // Land exactly: zooming about the centre can leave a sub-pixel drift.
  if (map.getZoom() !== zoom) map.setZoom(zoom);
  map.panTo(center);
  return flight === currentFlight;
}

/** Stop any flight in progress (a newer, non-animated move is taking over). */
export function cancelFlight() {
  currentFlight += 1;
}
