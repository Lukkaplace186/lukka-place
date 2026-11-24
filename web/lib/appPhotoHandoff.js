// The app's "photo grows into the listing" hand-off (2026-11-12).
//
// A listing card and the listing page's gallery carry the same view-transition
// name, so the browser animates one into the other (React's <ViewTransition>,
// node_modules/next/dist/docs/01-app/02-guides/view-transitions.md). The
// listing page streams behind a loading screen, so the card would have
// nothing to grow into: the tapped card leaves the exact image it was showing
// here, and the loading screen draws that image, already in the browser's
// cache, in the gallery's place under the same name.
//
// Memory only, one entry, short-lived: nothing is stored on the phone.

const MAX_AGE_MS = 15000;
let last = null;

export function listingPhotoTransitionName(id) {
  return `listing-photo-${id}`;
}

/** The listing id at the head of a listing path segment ("885-appartement-…" → "885"). */
export function listingIdOfSegment(segment) {
  const match = /^(\d+)/.exec(String(segment || ''));
  return match ? match[1] : null;
}

/** Called by a card as it is tapped, with the card's photo box. */
export function rememberListingPhoto(id, box, now = Date.now()) {
  const src = visiblePhotoSrc(box);
  last = src ? { id: String(id), src, at: now } : null;
}

export function recallListingPhoto(id, now = Date.now()) {
  if (!last || last.id !== String(id) || now - last.at > MAX_AGE_MS) return null;
  return last.src;
}

// The image the card is showing right now: in a swiped strip, the one whose
// box overlaps the card's own.
function visiblePhotoSrc(box) {
  if (!box || typeof box.querySelectorAll !== 'function') return null;
  const frame = box.getBoundingClientRect();
  const middle = frame.left + frame.width / 2;
  for (const img of box.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (r.left <= middle && r.right >= middle && (img.currentSrc || img.src)) return img.currentSrc || img.src;
  }
  return null;
}
