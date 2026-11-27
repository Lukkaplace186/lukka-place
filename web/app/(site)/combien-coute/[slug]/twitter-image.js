import Image from './opengraph-image';

/**
 * twitter:image — the same card as og:image (./opengraph-image.js). Next
 * needs one file per tag; the config is repeated rather than re-exported
 * because Next reads these exports from this file itself.
 */
export const alt = 'Guide des loyers Lukka Place : loyer médian demandé';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

export default Image;
