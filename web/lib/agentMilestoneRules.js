/**
 * Which agent "first" to celebrate (components/AgentMilestoneCelebration.js):
 * only one reached in the last RECENT_DAYS and not yet shown on this device,
 * the most important first.
 */
export const RECENT_DAYS = 14;
const ORDER = ['firstDeal', 'firstVisit', 'firstTap', 'firstView'];

/** Pure: which first to celebrate now, given what is stored as seen. */
export function milestoneToCelebrate(milestones, seen, now = Date.now()) {
  const cutoff = now - RECENT_DAYS * 24 * 3600 * 1000;
  const fresh = (milestones || []).filter((m) => !seen.has(m.key) && Date.parse(m.at) >= cutoff);
  for (const key of ORDER) {
    const hit = fresh.find((m) => m.key === key);
    if (hit) return hit;
  }
  return null;
}
