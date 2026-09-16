/**
 * Who in the Lukka Place team may do what in /admin.
 *
 * Pure data, no `server-only`: the sidebar (a client component) hides what a
 * role cannot open, and the server enforces the same table on every page and
 * every action (lib/adminSession.js requireAdmin / requirePagePermission).
 * Hiding a link is a courtesy; the server check is the rule.
 *
 * Roles are deliberately few and job-shaped rather than a free-form permission
 * builder: a moderator approves listings, support helps agents and customers,
 * finance handles plans and payments, an analyst reads. `owner` is everything,
 * including managing the team and reading the audit log.
 */

// `sales` is a field rep: their own performance and commissions (/admin/sales),
// plus the read-only views every role has.
export const ADMIN_ROLES = ['owner', 'moderator', 'support', 'finance', 'analyst', 'sales'];

const ALL = ADMIN_ROLES;

export const PERMISSIONS = {
  // Reading
  'analytics.view': ALL,
  'listings.view': ALL,
  'agents.view': ALL,
  'leads.view': ['owner', 'moderator', 'support', 'analyst'],
  'customers.view': ['owner', 'support'],
  'billing.view': ['owner', 'finance'],
  // Acting
  'listings.moderate': ['owner', 'moderator'],
  'listings.edit': ['owner', 'moderator'],
  'agents.manage': ['owner', 'moderator', 'support'],
  'agents.bulk': ['owner', 'moderator'],
  'agents.security': ['owner', 'support'],
  'customers.manage': ['owner', 'support'],
  'leads.manage': ['owner', 'moderator', 'support'],
  'conversations.reply': ['owner', 'support'],
  'viewings.manage': ['owner', 'support'],
  'billing.manage': ['owner', 'finance'],
  // A `sales` user sees only the rep record linked to their own account.
  'sales.view': ['owner', 'finance', 'sales'],
  'sales.manage': ['owner', 'finance'],
  // "View as" an agent or customer — read-only, reasoned, logged (lib/impersonation.js).
  'accounts.impersonate': ['owner', 'support'],
  'routing.manage': ['owner'],
  'cms.manage': ['owner'],
  'data.export': ['owner', 'finance', 'analyst'],
  'notes.write': ['owner', 'moderator', 'support', 'finance'],
  // Administration
  'team.manage': ['owner'],
  'audit.view': ['owner'],
  'health.view': ['owner', 'moderator', 'support', 'finance', 'analyst'],
};

/** @returns {boolean} */
export function can(role, permission) {
  if (!permission) return true;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false; // an unknown permission is refused, never assumed open
  return allowed.includes(role);
}

/**
 * The permission needed to OPEN each console section. Longest prefix wins, so
 * `/admin/agents/123` inherits `/admin/agents`.
 */
export const SECTION_PERMISSIONS = {
  '/admin/dashboard': 'analytics.view',
  '/admin/listings': 'listings.view',
  '/admin/conversations': 'leads.view',
  '/admin/leads': 'leads.view',
  '/admin/matching': 'analytics.view',
  '/admin/viewings': 'leads.view',
  '/admin/market-data': 'analytics.view',
  '/admin/benchmarks': 'analytics.view',
  '/admin/telemetry': 'analytics.view',
  '/admin/agents': 'agents.view',
  '/admin/agencies': 'agents.view',
  '/admin/customers': 'customers.view',
  '/admin/subscriptions': 'billing.view',
  '/admin/billing': 'billing.view',
  '/admin/sales': 'sales.view',
  '/admin/sales/attribution': 'sales.manage',
  '/admin/impersonation': 'audit.view',
  '/admin/cms': 'cms.manage',
  '/admin/team': 'team.manage',
  '/admin/audit': 'audit.view',
  '/admin/health': 'health.view',
  '/admin/export': 'data.export',
  // Opening the queue is agents.view; approving, rejecting, opening a document
  // and setting a level are agents.manage (enforced in each action/route).
  '/admin/verifications': 'agents.view',
};

export function sectionPermission(pathname) {
  const match = Object.keys(SECTION_PERMISSIONS)
    .filter((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? SECTION_PERMISSIONS[match] : null;
}

export const ROLE_LABEL_KEYS = Object.fromEntries(ADMIN_ROLES.map((role) => [role, `admin.team.role.${role}`]));
