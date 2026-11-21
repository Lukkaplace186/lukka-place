/**
 * The WhatsApp sheet's own funnel, as log lines (2026-11-21). From
 * 2026-11-19 15:17 UTC to 11-21 05:56 UTC the listing page's bottom-bar
 * WhatsApp recorded no tap while listing visitors were at a record and no
 * deploy, setting or rate limit explained it. What we recorded could not say
 * whether people stopped tapping or their taps were lost in the browser:
 * nothing marked the sheet opening. Now each step is one line —
 *   [wa-sheet] {"step":"open","placement":"listing_mobile_bar","listingId":1272,"ua":"fb_inapp"}
 * and /api/telemetry/lead-click logs one [lead-click] line per request it
 * answers. open → choose → lead-click separates "nobody taps" from "taps are
 * lost" within a day. Read on the VPS with
 *   pm2 logs lukka-place-web --lines 20000 --nostream | grep -E '\[(wa-sheet|lead-click)\]'
 * No table, no free text, no visitor identifier.
 */
export const WA_SHEET_STEPS = ['open', 'choose'];
const PLACEMENTS = ['card', 'listing_desktop', 'listing_mobile_bar', 'map_card'];

/** The browser kind from a User-Agent: in-app browsers are where a tap can be swallowed. */
export function userAgentKind(ua) {
  const text = String(ua || '');
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(text)) return 'fb_inapp';
  if (/Instagram/i.test(text)) return 'ig_inapp';
  if (/TikTok|musical_ly|BytedanceWebview/i.test(text)) return 'tiktok_inapp';
  if (/; wv\)|WebView/i.test(text)) return 'webview';
  return 'browser';
}

export function sanitizeWaSheetEvent(body) {
  if (!body || !WA_SHEET_STEPS.includes(body.step)) return null;
  const listingId = Number.parseInt(body.listingId, 10);
  return {
    step: body.step,
    placement: PLACEMENTS.includes(body.placement) ? body.placement : null,
    listingId: Number.isInteger(listingId) && listingId > 0 ? listingId : null,
  };
}
