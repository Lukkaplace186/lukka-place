// Icon sizing shared by every lucide icon (see lib/constants.js, which
// re-exports these). Its own module since 2026-11-21: the public shell
// (Header, SignupNudge, AccountLimitNotice, OfflineBanner) needs only the
// stroke width, and importing it from lib/constants.js put that whole module
// (amenity keyword lists, filter options, ~12 KB) in every page's JavaScript.
export const ICON_SIZE = 18;
export const ICON_STROKE_WIDTH = 1.75;
export const ICON_ACCENT_CLASS = 'text-blue-deep';
