import { getImageProps } from 'next/image';
import { prefersLightData } from './useSaveData';
import { usableImageSrc } from './listingView';
import { DETAIL_HERO_SIZES, DETAIL_SIDE_SIZES } from './detailGallerySizes';

/** Below `sm` the detail page shows a 100vw carousel — the card's own photo already. */
const MOSAIC_MIN_WIDTH = 640;

const warmed = new Set();

/**
 * Starts downloading the photos a listing's detail page opens with, while the
 * mouse is still on its card (speed pass, 2026-11-06). On a ~450 ms-RTT link
 * the gallery otherwise asks for them only after the page's own payload has
 * arrived, one round trip later. Desktop / tablet mosaic only (a phone's
 * detail carousel reuses the card's 100vw photo); never on Data Saver / 2G;
 * once per photo per page load.
 */
export function warmListingPhotos(images) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  if (window.innerWidth < MOSAIC_MIN_WIDTH || prefersLightData()) return;
  (images || []).slice(0, 3).forEach((src, i) => {
    if (!usableImageSrc(src) || warmed.has(src)) return;
    warmed.add(src);
    try {
      const { props } = getImageProps({ src, alt: '', fill: true, sizes: i === 0 ? DETAIL_HERO_SIZES : DETAIL_SIDE_SIZES });
      const img = new Image();
      img.decoding = 'async';
      if (props.sizes) img.sizes = props.sizes;
      if (props.srcSet) img.srcset = props.srcSet;
      img.src = props.src;
    } catch {
      warmed.delete(src);
    }
  });
}
