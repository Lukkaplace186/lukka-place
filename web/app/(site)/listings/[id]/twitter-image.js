import Image from './opengraph-image';

/**
 * twitter:image — the same card as og:image (./opengraph-image.js). Next
 * needs one file per tag; the config is repeated rather than re-exported
 * because Next reads these exports from this file itself.
 */
export const alt = 'Annonce Lukka Place : photo, prix et caractéristiques du bien';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/jpeg';
export const revalidate = 600;

export default Image;
