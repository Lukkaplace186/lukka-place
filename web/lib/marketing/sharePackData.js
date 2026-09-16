import { formatPriceParts } from '../format';
import { roomSpecs } from '../listingShareCopy';
import { listingImages } from '../listingView';
import { NO_PHOTO_URL } from '../constants';

/**
 * What the browser needs to draw a listing's graphics with no further server
 * help: the text already formatted, and SAME-ORIGIN image URLs.
 *
 * Same-origin is the point. A canvas that draws a cross-origin image without
 * CORS approval is "tainted" and refuses to export. Supabase Storage does send
 * `Access-Control-Allow-Origin: *` (checked on production), but going through
 * Next's own optimiser (`/_next/image`) sidesteps the question entirely AND
 * sends a 1080px variant instead of a phone's 4000px original — the difference
 * between ~100 KB and several MB on 3G, and between a smooth decode and a
 * crashed tab on a 2 GB Android.
 *
 * Only images next.config.mjs's `remotePatterns` covers (Supabase public
 * storage, lukkaplace.com/assets/img) or local paths are sent; anything else
 * would 400 at the optimiser and is dropped here instead, the same allow-list
 * posture lib/listingFlyer.js takes on the server.
 */

export const PHOTO_WIDTH = 1080;
// Must be one of Next's `imageSizes`/`deviceSizes`; 384 is the largest imageSize.
export const LOGO_WIDTH = 384;
// next.config.mjs sets `images.qualities: [75]` — any other value is coerced.
export const IMAGE_QUALITY = 75;
export const MAX_PHOTOS = 3;

export function optimisableImageSrc(src, { supabaseHost = null } = {}) {
  if (typeof src !== 'string') return false;
  const value = src.trim();
  if (!value || value === NO_PHOTO_URL) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (supabaseHost && url.host === supabaseHost) return url.pathname.startsWith('/storage/v1/object/public/');
    return url.host === 'lukkaplace.com' && url.pathname.startsWith('/assets/img/');
  } catch {
    return false;
  }
}

export function optimisedImageUrl(src, width) {
  return `/_next/image?url=${encodeURIComponent(src.trim())}&w=${width}&q=${IMAGE_QUALITY}`;
}

export function purposeLabel(purpose) {
  if (purpose === 'sale') return 'À VENDRE';
  if (purpose === 'rent') return 'À LOUER';
  return null;
}

/**
 * @param {object} listing  A lib/listingFlyer.js getFlyerListing row.
 * @param {{typeText: string|null, brand: {name, initials, phone, badge},
 *          supabaseHost?: string|null, markPath: string, fetchedAt: string}} options
 */
export function buildFlyerPack(listing, { typeText, brand, supabaseHost = null, markPath, fetchedAt }) {
  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  const photos = listingImages(listing)
    .filter((src) => optimisableImageSrc(src, { supabaseHost }))
    // A couple of spares: a photo that fails to download or decode is skipped
    // by the browser, and the next one takes its slot.
    .slice(0, MAX_PHOTOS + 2)
    .map((src) => optimisedImageUrl(src, PHOTO_WIDTH));
  const logo = optimisableImageSrc(listing.agent_image, { supabaseHost })
    ? optimisedImageUrl(listing.agent_image, LOGO_WIDTH)
    : null;

  return {
    listingId: Number(listing.id),
    fetchedAt,
    purposeLabel: purposeLabel(listing.purpose),
    amount,
    period,
    typeText: typeText || null,
    place: place || null,
    facts: [typeText, place].filter(Boolean).join(' • '),
    rooms: roomSpecs(listing).join(' • '),
    photos,
    mark: markPath,
    agent: {
      name: brand?.name || null,
      initials: brand?.initials || null,
      phone: brand?.phone || null,
      badge: brand?.badge || null,
      logo,
    },
  };
}
