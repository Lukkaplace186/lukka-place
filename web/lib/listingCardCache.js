'use client';

import { getSharePackAction } from '@/app/compte/agent/shareActions';
import { getTeamSharePackAction } from '@/app/admin/listings/shareActions';
import { fetchPackImages, loadSharePack, prefetchPackPhotos, saveSharePack } from '@/lib/sharePack';
import { expectedPackPhotoUrls } from '@/lib/marketing/sharePackData';
import { decodeAssets, loadRenderFont, renderFlyer } from '@/components/marketing/CanvasRenderer';

/**
 * The listing card (square), drawn once and kept for the page's lifetime, so
 * "Partager sur WhatsApp" opens on a finished card instead of
 * "Préparation de l'image…" (2026-10-06 speed pass: ~1.9 s measured on
 * listing 310, almost all of it the photo downloads).
 *
 * `prepareListingCard(listing)` returns one shared promise per listing
 * version: the share button prepares it in the background when it scrolls
 * into view (`warmListingCard`), the row menu when it opens, and the dialog
 * awaits the same promise — so a tap after the warm-up costs nothing, and a
 * tap during it waits only for what is left.
 *
 * Why in the browser and not pre-rendered on the server at publish time: the
 * card is drawn with the browser's canvas (one renderer, retired server copy
 * — see web/CLAUDE.md, "Listing card share"), it changes whenever the price,
 * photos or the agent's logo change, and a stored image of last month's price
 * is a card that lies. Warming on view gives the same instant tap without a
 * second renderer to keep in step.
 *
 * Keyed by id + the row fields the card shows, so an edited price or cover
 * photo draws a new card. Entries expire after CARD_TTL_MS. A failure is
 * never cached: the next tap tries again.
 *
 * Resolves to `{ status: 'ready', kit, blob }`, `{ status: 'blocked', kit }`
 * (the server says the listing cannot be shared), or `{ status: 'failed', kit }`.
 *
 * `format` is 'square' (the default, and the only one warmed) or 'feed', the
 * 4:5 "Carte feed social" ListingQuickShare offers beside it. Both formats
 * draw from ONE kit per listing version (kitCache), so switching to 4:5 costs
 * a redraw — tens of milliseconds — not a second pack request and download.
 *
 * `audience: 'team'` is Lukka Place drawing a card for its own pages, from
 * /admin/listings/[id]: the kit comes from the admin action (any agent's live
 * listing, the company's utm_source), and nothing is read from or written to
 * this phone's offline copies, which are an agent's own listings.
 */

const CARD_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const kitCache = new Map();

export function listingCardKey(listing, format = 'square', audience = 'agent') {
  return [listing.id, listing.price, listing.title, listing.featured_image, listing.updated_at, format, audience]
    .map((v) => v ?? '')
    .join('|');
}

/** The kit for a listing version, shared by every format; failures are not kept. */
function cachedKit(listing, audience) {
  const key = listingCardKey(listing, '', audience);
  const hit = kitCache.get(key);
  if (hit && Date.now() - hit.at < CARD_TTL_MS) return hit.promise;
  const promise = loadKit(listing, audience).then((result) => {
    if (!result.kit) kitCache.delete(key);
    return result;
  });
  kitCache.set(key, { promise, at: Date.now() });
  return promise;
}

async function loadKit(listing, audience) {
  const listingId = listing.id;
  const team = audience === 'team';
  // The photos start now, beside the pack request rather than after it.
  prefetchPackPhotos(expectedPackPhotoUrls(listing));
  let result = null;
  try {
    result = await (team ? getTeamSharePackAction : getSharePackAction)(listingId);
  } catch {
    result = null; // unreachable — try the copy this phone stored
  }
  if (result?.ok) {
    const blobs = await fetchPackImages(result.pack);
    if (!team && (blobs.photos.length || !result.pack.photos.length)) saveSharePack(listingId, { kit: result, ...blobs });
    return { kit: result, blobs };
  }
  // "Not yours" / gone: never papered over with a stored copy.
  if (result) return { kit: null, blobs: null, refused: true };
  if (team) return { kit: null, blobs: null };
  const stored = await loadSharePack(listingId);
  if (!stored) return { kit: null, blobs: null };
  return {
    kit: stored.kit,
    blobs: {
      photos: stored.photos || [],
      logo: stored.logo || null,
      mark: stored.mark || null,
      markLight: stored.markLight || null,
      wordmark: stored.wordmark || null,
    },
  };
}

async function draw(listing, format, audience) {
  const { kit, blobs, refused } = await cachedKit(listing, audience);
  if (refused || !kit) return { status: 'failed', kit: null };
  if (!kit.shareable) return { status: 'blocked', kit };
  let assets = null;
  try {
    const [family, decoded] = await Promise.all([loadRenderFont(), decodeAssets(blobs)]);
    assets = decoded;
    const { blob } = await renderFlyer(kit.pack, format, decoded, family);
    return { status: 'ready', kit, blob };
  } catch {
    return { status: 'failed', kit };
  } finally {
    for (const image of Object.values(assets?.images || {})) image?.close?.();
  }
}

export function prepareListingCard(listing, format = 'square', { audience = 'agent' } = {}) {
  const key = listingCardKey(listing, format, audience);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CARD_TTL_MS) return hit.promise;
  const promise = draw(listing, format, audience).then((result) => {
    if (result.status !== 'ready') cache.delete(key);
    return result;
  });
  cache.set(key, { promise, at: Date.now() });
  return promise;
}

/**
 * Background warm-up, polite about the agent's data plan: never on Data
 * Saver or 2G, one card at a time, at most WARM_LIMIT per page view, and only
 * once the browser is idle.
 */
const WARM_LIMIT = 6;
let warmed = 0;
let queue = Promise.resolve();

function connectionAllowsWarmup() {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)2g$/.test(connection.effectiveType || '');
}

const whenIdle = () =>
  new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 300);
  });

export function warmListingCard(listing) {
  const key = listingCardKey(listing);
  if (cache.has(key) || warmed >= WARM_LIMIT || !connectionAllowsWarmup()) return;
  warmed += 1;
  queue = queue.then(whenIdle).then(() => prepareListingCard(listing)).catch(() => {});
}
