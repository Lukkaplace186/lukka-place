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
  // 4:5, the tallest a photo post can be in the Instagram and Facebook feeds
  // (2026-10-26, "Carte feed social"). ListingQuickShare offers it beside the square.
  feed: Object.freeze({ key: 'feed', width: 1080, height: 1350 }),
});

export const FORMAT_KEYS = Object.freeze(Object.keys(FORMATS));

export const REPORT_FORMAT = Object.freeze({ key: 'report', width: 1080, height: 1080 });

/**
 * The exported card's JPEG quality and its byte budget. Raised 2026-11-06
 * (owner: the cards "are not HD"): 0.82 under a 150 KB budget, falling to
 * 0.70 on busy photos, softened the lettering before Instagram and Facebook
 * re-compressed it again. The size stays NATIVE (1080 wide, above), which is
 * what the platforms display; only the encoding is gentler. One lower pass
 * (0.86) when a busy set of photos passes the budget.
 */
export const EXPORT_JPEG_QUALITY = 0.92;
export const EXPORT_JPEG_FALLBACK_QUALITY = 0.86;
export const EXPORT_BYTE_BUDGET = 400 * 1024;

export function formatFileName(listingId, formatKey) {
  return `lukka-place-bien-${listingId}-${formatKey}.jpg`;
}
