/**
 * The photography perks a plan carries (packages.photo_sessions_per_month,
 * packages.photo_discount_pct — set per plan in /admin/subscriptions), as the
 * lines an agent reads on /compte/agent/abonnement. A perk at 0 produces no
 * line: an empty "0 séance incluse" row would advertise nothing as something.
 *
 * Pure and client-safe — AgentPlanPicker is a client component.
 *
 * @param {{sessions?: number|null, discountPct?: number|null}} perks
 * @param {(key: string, vars?: object) => string} t
 * @returns {string[]}
 */
export function photoPerkLines({ sessions, discountPct }, t) {
  const lines = [];
  const n = Number(sessions) || 0;
  const pct = Number(discountPct) || 0;
  if (n > 0) lines.push(t(n === 1 ? 'agent.plans.photoSessionsOne' : 'agent.plans.photoSessionsMany', { count: n }));
  if (pct > 0) lines.push(t('agent.plans.photoDiscount', { pct }));
  return lines;
}
