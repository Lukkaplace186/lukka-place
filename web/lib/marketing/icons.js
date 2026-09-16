/**
 * Glyph paths shared by the server flyer (app/compte/agent/biens/[id]/visuel,
 * as SVG data URIs) and the browser renderer (components/marketing/CanvasRenderer.js,
 * as Path2D). Both on a 24×24 grid.
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
