/**
 * The detail page's desktop mosaic `sizes` (components/PhotoGallery.js), in
 * their own module so lib/warmListingPhotos.js and the tests can share them.
 * A photo warmed from a card is only a cache hit when the browser picks the
 * same srcset candidate the gallery will, so the two must not drift.
 */
export const DETAIL_HERO_SIZES = '(min-width: 1280px) 830px, (min-width: 1024px) 64vw, 100vw';
export const DETAIL_SIDE_SIZES = '(min-width: 1280px) 410px, (min-width: 1024px) 32vw, 50vw';
