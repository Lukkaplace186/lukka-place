/**
 * Glyph paths for the browser renderer (components/marketing/CanvasRenderer.js,
 * as Path2D), on a 24×24 grid.
 *
 * The WhatsApp path is the same one components/WhatsAppCTA.js hand-rolls —
 * this lucide version ships no brand glyphs. Drawn rather than typed because
 * Plus Jakarta Sans has no ✓, and a missing glyph is a blank box.
 */
export const WHATSAPP_PATH =
  'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.13c-.24.68-1.4 1.3-1.93 1.38-.5.08-1.12.11-1.8-.11-.42-.13-.95-.3-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.14-.19-1.17-1.56-1.17-2.98s.73-2.11 1-2.4c.26-.29.57-.36.76-.36h.55c.18 0 .42-.07.65.5.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.28.36-.23.6-.14.24.09 1.55.73 1.81.86.26.14.44.2.5.31.07.12.07.68-.17 1.35z';

/** lucide "check", stroked at CHECK_STROKE_WIDTH with round caps and joins. */
export const CHECK_PATH = 'M20 6 9 17l-5-5';
export const CHECK_STROKE_WIDTH = 3.5;

/**
 * Line icons for the listing card (2026-10-06 redesign), copied from the
 * lucide-react version this app ships (map-pin, bed, bath, maximize,
 * door-closed) so the graphic speaks the same icon language as the site.
 * Stroked at LINE_ICON_STROKE_WIDTH on the 24×24 grid, round caps and joins.
 * The map pin's circle is written as two arcs, since Path2D takes paths only.
 */
export const LINE_ICONS = Object.freeze({
  pin: [
    'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    'M15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
  ],
  bed: ['M2 4v16', 'M2 8h18a2 2 0 0 1 2 2v10', 'M2 17h20', 'M6 8v9'],
  bath: [
    'M10 4 8 6',
    'M17 19v2',
    'M2 12h20',
    'M7 19v2',
    'M9 5 7.621 3.621A2.121 2.121 0 0 0 4 5v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
  ],
  area: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  door: ['M10 12h.01', 'M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14', 'M2 20h20'],
  // lucide "tag" — the listing reference chip.
  tag: [
    'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
    'M7.5 7.5h.01',
  ],
  // lucide "badge-check" — "Vérifié par Lukka Place" on the feed card.
  badgeCheck: [
    'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z',
    'm9 12 2 2 4-4',
  ],
  // lucide "image" — the feed card's photo count. Its rect and circle written as paths.
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M11 9a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
    'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
  ],
});

export const LINE_ICON_STROKE_WIDTH = 2.25;
