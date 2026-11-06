/**
 * The dashboard's four tabs, as plain data (pure, unit-tested). URL-driven
 * like every console view: `?tab=demande` is linkable and survives a refresh,
 * and only the open tab's queries run.
 *
 * Each tab needs a permission (lib/adminRoles.js); a role only sees the tabs
 * it may open, and lands on the one closest to its job.
 */
import { can } from './adminRoles.js';

export const DASHBOARD_TABS = [
  { key: 'apercu', labelKey: 'admin.dashboard.tabs.executive', permission: 'analytics.view' },
  { key: 'demande', labelKey: 'admin.dashboard.tabs.demand', permission: 'analytics.view' },
  { key: 'offre', labelKey: 'admin.dashboard.tabs.supply', permission: 'listings.view' },
  { key: 'marche', labelKey: 'admin.dashboard.tabs.market', permission: 'market.view' },
];

/** Where each role opens: the tab that answers the question it works on. */
const ROLE_DEFAULT_TAB = {
  moderator: 'offre',
  support: 'demande',
  sales: 'offre',
};

export function visibleDashboardTabs(role) {
  return DASHBOARD_TABS.filter((tab) => can(role, tab.permission));
}

/** `?tab=` → a tab this role may open; anything else → its default. */
export function parseDashboardTab(value, role) {
  const key = Array.isArray(value) ? value[0] : value;
  const tabs = visibleDashboardTabs(role);
  const asked = tabs.find((tab) => tab.key === key);
  if (asked) return asked;
  const preferred = tabs.find((tab) => tab.key === ROLE_DEFAULT_TAB[role]);
  return preferred || tabs[0] || DASHBOARD_TABS[0];
}

/** A dashboard link keeping the period and tab; defaults are left out of the URL. */
export function dashboardHref({ tab, periode, chambres = null } = {}) {
  const params = new URLSearchParams();
  if (tab) params.set('tab', tab);
  if (periode) params.set('periode', periode);
  if (chambres !== null && chambres !== undefined) params.set('chambres', String(chambres));
  const query = params.toString();
  return query ? `/admin/dashboard?${query}` : '/admin/dashboard';
}

/** Work-queue cards per tab (keys of lib/adminWorkQueues.js counts). */
export const TAB_QUEUES = {
  apercu: ['pendingListings', 'escalatedViewings', 'humanConversations', 'failedPushes24h', 'pendingPlanRequests', 'expiringMemberships'],
  demande: ['escalatedViewings', 'awaitingAgent', 'humanConversations', 'failedPushes24h', 'lockedCustomers'],
  offre: ['pendingListings', 'suspendedListings', 'unansweredAvailability', 'unverifiedAgents'],
  marche: [],
};

/** Bedroom filters on the rent index; null = every bedroom count. */
export const RENT_INDEX_BEDS = [null, 1, 2, 3, 4];

export function parseRentBeds(value) {
  const n = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  return RENT_INDEX_BEDS.includes(n) ? n : null;
}
