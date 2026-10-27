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
  // Network-wide reads a field rep has no business in: market figures and the
  // agents' identity documents (Verifications). Everyone else with analytics.view.
  'market.view': ['owner', 'moderator', 'support', 'finance', 'analyst'],
  'verifications.view': ['owner', 'moderator', 'support', 'finance', 'analyst'],
  // Partners (agents, creators, campaigns) and their funnels; the tagged-link
  // builder. A field rep has their own rep page instead.
  'partners.view': ['owner', 'moderator', 'support', 'finance', 'analyst'],
  // Acting
  'listings.moderate': ['owner', 'moderator'],
  'listings.edit': ['owner', 'moderator'],
  // /admin/projets: create, edit, publish and verify developer projects.
  'projects.manage': ['owner', 'moderator'],
  'agents.manage': ['owner', 'moderator', 'support'],
  'agents.bulk': ['owner', 'moderator'],
  'agents.security': ['owner', 'support'],
  // Irreversible: removes the account and its per-agent records (lib/adminAgentDeletion.js).
  'agents.delete': ['owner'],
  // Bulk "Supprimer la sélection" on the approval queue: a soft delete with undo (lib/adminSoftDelete.js).
  'listings.delete': ['owner'],
  // Permanent: engine SQLite rows, no undo (app/admin/recordDeleteActions.js).
  'leads.delete': ['owner'],
  'viewings.delete': ['owner'],
  'customers.manage': ['owner', 'support'],
  // Permanent: the customer account with its favourites and alerts (FK cascade).
  'customers.delete': ['owner'],
  'leads.manage': ['owner', 'moderator', 'support'],
  'conversations.reply': ['owner', 'support'],
  'viewings.manage': ['owner', 'support'],
  'billing.manage': ['owner', 'finance'],
  // A `sales` user sees only the rep record linked to their own account.
  'sales.view': ['owner', 'finance', 'sales'],
  'sales.manage': ['owner', 'finance'],
  // Removing a commission plan or a rep from the team.
  'sales.delete': ['owner'],
  // "View as" an agent or customer — read-only, reasoned, logged (lib/impersonation.js).
  'accounts.impersonate': ['owner', 'support'],
  'routing.manage': ['owner'],
  // Creating a creator or campaign code, editing its fee, switching a code off.
  'partners.manage': ['owner'],
  'cms.manage': ['owner'],
  'data.export': ['owner', 'finance', 'analyst'],
  'notes.write': ['owner', 'moderator', 'support', 'finance'],
  // Administration
  'team.manage': ['owner'],
  'audit.view': ['owner'],
  'health.view': ['owner', 'moderator', 'support', 'finance', 'analyst'],
};

/** @returns {boolean} */
/**
 * Where each role lands on /admin: the queue that is its job. The console
 * used to send everyone to Conversations, which a sales rep or an analyst is
 * not even allowed to open.
 */
export const ROLE_HOME = {
  owner: '/admin/dashboard',
  moderator: '/admin/listings',
  support: '/admin/viewings',
  finance: '/admin/billing',
  analyst: '/admin/telemetry',
  sales: '/admin/sales/me',
};

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
  '/admin/projets': 'listings.view',
  '/admin/demande': 'analytics.view',
  '/admin/conversations': 'leads.view',
  '/admin/leads': 'leads.view',
  '/admin/matching': 'analytics.view',
  '/admin/viewings': 'leads.view',
  '/admin/market-data': 'market.view',
  '/admin/investisseurs': 'market.view',
  '/admin/benchmarks': 'analytics.view',
  '/admin/telemetry': 'analytics.view',
  '/admin/agents': 'agents.view',
  '/admin/agencies': 'agents.view',
  '/admin/customers': 'customers.view',
  // Pasting Facebook group posts adds agent prospects (lib/facebookProspects.js).
  '/admin/prospects': 'agents.manage',
  '/admin/subscriptions': 'billing.view',
  '/admin/billing': 'billing.view',
  '/admin/sales': 'sales.view',
  '/admin/sales/attribution': 'sales.manage',
  '/admin/impersonation': 'audit.view',
  '/admin/cms': 'cms.manage',
  '/admin/settings': 'cms.manage',
  '/admin/team': 'team.manage',
  '/admin/audit': 'audit.view',
  '/admin/health': 'health.view',
  '/admin/export': 'data.export',
  // Opening the queue is agents.view; approving, rejecting, opening a document
  // and setting a level are agents.manage (enforced in each action/route).
  '/admin/verifications': 'verifications.view',
  // Reading ratings is agents.view; publishing or refusing a comment is
  // listings.moderate (app/admin/agent-reviews/actions.js).
  '/admin/agent-reviews': 'agents.view',
  '/admin/partenaires': 'partners.view',
  '/admin/liens': 'partners.view',
};

export function sectionPermission(pathname) {
  const match = Object.keys(SECTION_PERMISSIONS)
    .filter((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? SECTION_PERMISSIONS[match] : null;
}

export const ROLE_LABEL_KEYS = Object.fromEntries(ADMIN_ROLES.map((role) => [role, `admin.team.role.${role}`]));
