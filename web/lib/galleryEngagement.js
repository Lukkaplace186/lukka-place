/**
 * When a visitor has "looked at the photos", and when they have "gone through
 * all of them" — the two gallery steps of the listing funnel
 * (`gallery_open`, `gallery_complete`; lib/analyticsClient.js).
 *
 * Pure, so the rules are tested rather than read off a component.
 *
 * - **Engaged** = the visitor did something to see more than the lead photo:
 *   opened the full-screen viewer, or swiped the phone carousel past photo 1.
 *   The lead photo alone is what every page view shows; counting it would
 *   make `gallery_open` a second page view.
 * - **Complete** = distinct photos actually brought on screen (carousel or
 *   viewer) reach 80% of the gallery, never fewer than 2. The desktop mosaic
 *   shows three tiles without the visitor doing anything, so those do not
 *   count as seen — only photos the visitor paged to do, plus the lead.
 *   A single-photo listing has nothing to "go through" and never completes.
 */

export const COMPLETE_SHARE = 0.8;

/** Distinct photos that must have been seen for `gallery_complete`, or null. */
export function galleryCompleteThreshold(total) {
  const count = Number(total);
  if (!Number.isInteger(count) || count < 2) return null;
  return Math.max(2, Math.ceil(count * COMPLETE_SHARE));
}

/**
 * The next state after one photo comes on screen, and which events to send.
 *
 * @param {{seen: Set<number>, opened: boolean, completed: boolean}} state
 * @param {{index: number, total: number, engaged: boolean}} step
 * @returns {{state: {seen: Set<number>, opened: boolean, completed: boolean}, events: string[]}}
 */
export function noteGalleryStep(state, { index, total, engaged }) {
  const seen = new Set(state.seen);
  if (Number.isInteger(index) && index >= 0 && index < total) seen.add(index);

  const events = [];
  let { opened, completed } = state;
  if (!opened && (engaged || index > 0)) {
    opened = true;
    events.push('gallery_open');
  }
  const threshold = galleryCompleteThreshold(total);
  if (opened && !completed && threshold !== null && seen.size >= threshold) {
    completed = true;
    events.push('gallery_complete');
  }
  return { state: { seen, opened, completed }, events };
}

/** The lead photo is on screen from the start. */
export function initialGalleryState() {
  return { seen: new Set([0]), opened: false, completed: false };
}
