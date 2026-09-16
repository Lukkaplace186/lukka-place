/**
 * The image formats the share kit can draw. Native sizes, not 2×: 1080 is
 * what Instagram and WhatsApp Status display and re-compress to, so a 2160px
 * export is ~3× the bytes (273 KB vs 90 KB, measured on listing 305) for
 * detail the platform discards before anyone sees it.
 */
export const FORMATS = Object.freeze({
  square: Object.freeze({ key: 'square', width: 1080, height: 1080 }),
  story: Object.freeze({ key: 'story', width: 1080, height: 1920 }),
  landscape: Object.freeze({ key: 'landscape', width: 1200, height: 675 }),
});

export const FORMAT_KEYS = Object.freeze(Object.keys(FORMATS));

export const REPORT_FORMAT = Object.freeze({ key: 'report', width: 1080, height: 1080 });

/**
 * Browsers' JPEG encoders are less efficient than mozjpeg, so the client
 * export runs a little lower than the server's 85 to stay inside the 150 KB
 * budget with the same photos.
 */
export const EXPORT_JPEG_QUALITY = 0.82;
export const EXPORT_BYTE_BUDGET = 150 * 1024;

export function formatFileName(listingId, formatKey) {
  return `lukka-place-bien-${listingId}-${formatKey}.jpg`;
}
