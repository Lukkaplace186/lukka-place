import 'server-only';
import { getAgentContactTapAlerts } from './adminApi';
import { getListingLabels } from './adminLeadRouting';
import { CONTACT_WINDOW_DAYS, contactOutcomeItems } from './contactOutcomeRules';

/**
 * The agent's contacts of the last 7 days for "Faites le point"
 * (lib/contactOutcomeRules.js). The engine down → `unavailable`, and the
 * section says so rather than showing "no contact".
 *
 * @returns {Promise<{items: Object[], unavailable: boolean}>}
 */
export async function getWeeklyContacts(agentId, now = new Date()) {
  if (!agentId) return { items: [], unavailable: false };
  const since = new Date(now.getTime() - CONTACT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let alerts;
  try {
    alerts = await getAgentContactTapAlerts({ agentId, since });
  } catch (err) {
    console.error(`[point] contacts of agent #${agentId}: engine read failed: ${err.message}`);
    return { items: [], unavailable: true };
  }
  const labels = await getListingLabels(alerts.map((a) => a.property_id)).catch(() => new Map());
  return { items: contactOutcomeItems(alerts, labels), unavailable: false };
}
