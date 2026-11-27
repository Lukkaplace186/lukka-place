/**
 * Query keys an ad or campaign link adds (lib/attribution.js keeps them for
 * the session). A /listings URL carrying one is where an ad landed, not a
 * search the visitor made (2026-11-21): from 2026-11-19 the Facebook ads'
 * filtered landing logged one "search" per paid visitor in search_events and
 * sent a Meta "Search" event for each.
 */
export const AD_LANDING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'gclid', 'ttclid'];

export function isAdLanding(params = {}) {
  return AD_LANDING_KEYS.some((key) => {
    const value = Array.isArray(params?.[key]) ? params[key][0] : params?.[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}
