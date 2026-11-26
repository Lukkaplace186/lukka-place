/**
 * Who in the Lukka Place team may do what in /admin.
 *
 * Pure data, no `server-only`: the sidebar (a client component) hides what a
 * role cannot open, and the server enforces the same table on every page and
 * every action (lib/adminSession.js requireAdmin / requirePagePermission).
 * Hiding a link is a courtesy; the server check is the rule.
 *
 * The built-in roles are job-shaped: a moderator approves listings, support
 * helps agents and customers, finance handles plans and payments, an analyst
 * reads. `owner` is everything, including managing the team and reading the
 * audit log.
 *
 * Since 2026-11-26 a person may hold SEVERAL roles (their permissions add up)
 * and an owner may define CUSTOM roles: a name plus a set of the permissions
 * below (`console_admin_custom_roles`, keys `custom:<id>`). `team.manage` is
 * never delegable — only the owner role grants it, so nobody can promote
 * themselves and "there is always an owner" stays meaningful. `owner` is held
 * alone: it already includes everything.
 *
 * `can()` takes a role key, a list of role keys, or a session/access object
 * carrying `permissions` (resolved server-side from built-in + custom roles).
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
  // /admin/market-data/marche: enter an advert read on Facebook / Zwandako,
  // exclude or restore an observation from the price guide.
  'market.manage': ['owner', 'moderator', 'analyst'],
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
  // Demo customer + agent pairs to try the product end to end (lib/demoAccounts.js).
  'accounts.demo': ['owner', 'support'],
  'routing.manage': ['owner'],
  // Creating a creator or campaign code, editing its fee, switching a code off,
  // announcing the referral programme to every agent.
  'partners.manage': ['owner'],
  // The agents' $1 credits: run, approve, pay, void (lib/referralCredits.js).
  'partners.payout': ['owner', 'finance'],
  // Typing a creator's weekly TikTok figures and the weekly ad spend.
  'partners.stats': ['owner', 'moderator', 'support', 'analyst'],
  'cms.manage': ['owner'],
  // Guides & Actualités (/admin/blog): write, publish, delete posts.
  'blog.manage': ['owner', 'moderator'],
  'data.export': ['owner', 'finance', 'analyst'],
  'notes.write': ['owner', 'moderator', 'support', 'finance'],
  // Administration
  'team.manage': ['owner'],
  'audit.view': ['owner'],
  'health.view': ['owner', 'moderator', 'support', 'finance', 'analyst'],
};

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

/**
 * @param {string|string[]|{permissions?: string[], roles?: string[], role?: string}|null} subject
 * @returns {boolean}
 */
export function can(subject, permission) {
  if (!permission) return true;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false; // an unknown permission is refused, never assumed open
  if (!subject) return false;
  if (typeof subject === 'string') return allowed.includes(subject);
  if (Array.isArray(subject)) return subject.some((role) => allowed.includes(role));
  if (Array.isArray(subject.permissions)) return subject.permissions.includes(permission);
  return can(subject.roles || subject.role || null, permission);
}

// ── Combined and custom roles ────────────────────────────────────────────────

/** Never granted by a custom role: managing the team stays with `owner`. */
export const NON_DELEGABLE_PERMISSIONS = ['team.manage'];

export const CUSTOM_ROLE_PREFIX = 'custom:';
const CUSTOM_ROLE_PATTERN = /^custom:([1-9][0-9]{0,17})$/;

export function customRoleKey(id) {
  return `${CUSTOM_ROLE_PREFIX}${Number(id)}`;
}

/** @returns {number|null} the custom role id inside a `custom:<id>` key */
export function customRoleId(key) {
  const match = CUSTOM_ROLE_PATTERN.exec(String(key || ''));
  return match ? Number(match[1]) : null;
}

export function isRoleKey(key) {
  return ADMIN_ROLES.includes(key) || customRoleId(key) !== null;
}

/**
 * Clean a list of role keys: known shapes only, no duplicates, built-in roles
 * first (in ADMIN_ROLES order), then custom roles by id. `owner` absorbs the
 * rest. The first key is the person's primary role — the one whose home page
 * they land on, stored in `console_admin_users.role`.
 * @returns {string[]}
 */
export function normalizeRoleKeys(keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).map((key) => String(key || '').trim()).filter(isRoleKey);
  if (list.includes('owner')) return ['owner'];
  const builtIn = ADMIN_ROLES.filter((role) => list.includes(role));
  const custom = [...new Set(list.map(customRoleId).filter((id) => id !== null))].sort((a, b) => a - b).map(customRoleKey);
  return [...builtIn, ...custom];
}

/** Permissions a custom role may carry: every known one except the non-delegable. */
export function cleanCustomPermissions(list) {
  const wanted = new Set(Array.isArray(list) ? list : []);
  return Object.keys(PERMISSIONS).filter((permission) => wanted.has(permission) && !NON_DELEGABLE_PERMISSIONS.includes(permission));
}

/**
 * Everything a set of roles may do: the union of each built-in role's row in
 * PERMISSIONS and each custom role's stored list. A custom key whose role was
 * not found grants nothing.
 * @param {string[]} roleKeys
 * @param {Array<{id: number, permissions: string[]}>} customRoles
 * @returns {string[]}
 */
export function resolvePermissions(roleKeys, customRoles = []) {
  const roles = normalizeRoleKeys(roleKeys);
  const byId = new Map(customRoles.map((role) => [Number(role.id), role]));
  const granted = new Set();
  for (const [permission, allowed] of Object.entries(PERMISSIONS)) {
    if (roles.some((role) => allowed.includes(role))) granted.add(permission);
  }
  for (const key of roles) {
    const custom = byId.get(customRoleId(key));
    if (custom) cleanCustomPermissions(custom.permissions).forEach((permission) => granted.add(permission));
  }
  return Object.keys(PERMISSIONS).filter((permission) => granted.has(permission));
}

/** The role keys a subject holds, whatever shape it came in. */
export function rolesOf(subject) {
  if (!subject) return [];
  if (typeof subject === 'string') return [subject];
  if (Array.isArray(subject)) return subject;
  if (Array.isArray(subject.roles)) return subject.roles;
  return subject.role ? [subject.role] : [];
}

/**
 * A field rep confined to their own rep page and their own agents: holds the
 * `sales` role and nothing that reaches further than it. Combining Commercial
 * with another role (built-in or custom) that grants more lifts the limit —
 * that person is trusted with the wider view by the other role.
 */
export function salesRepOnly(subject) {
  if (!rolesOf(subject).includes('sales')) return false;
  const permissions = subject && Array.isArray(subject.permissions) ? subject.permissions : resolvePermissions(rolesOf(subject));
  return permissions.every((permission) => PERMISSIONS[permission]?.includes('sales'));
}

/** Where a person opens /admin: their first role with a home they may open, else the first section they may. */
export function homeFor(subject) {
  for (const role of rolesOf(subject)) {
    const home = ROLE_HOME[role];
    if (home && can(subject, sectionPermission(home))) return home;
  }
  const first = Object.keys(SECTION_PERMISSIONS).find((path) => can(subject, SECTION_PERMISSIONS[path]));
  return first || '/admin/dashboard';
}

/**
 * The permission checklist on /admin/team, grouped the way the console is.
 * Every key of PERMISSIONS but the non-delegable appears exactly once
 * (tests/unit/admin-custom-roles.test.js).
 */
export const PERMISSION_GROUPS = [
  { key: 'listings', permissions: ['listings.view', 'listings.moderate', 'listings.edit', 'listings.delete', 'projects.manage', 'blog.manage'] },
  { key: 'agents', permissions: ['agents.view', 'agents.manage', 'agents.bulk', 'agents.security', 'agents.delete', 'verifications.view'] },
  {
    key: 'customers',
    permissions: ['leads.view', 'leads.manage', 'leads.delete', 'customers.view', 'customers.manage', 'customers.delete', 'conversations.reply', 'viewings.manage', 'viewings.delete', 'accounts.impersonate', 'accounts.demo', 'notes.write'],
  },
  { key: 'money', permissions: ['billing.view', 'billing.manage', 'sales.view', 'sales.manage', 'sales.delete', 'partners.view', 'partners.manage', 'partners.payout', 'partners.stats'] },
  { key: 'data', permissions: ['analytics.view', 'market.view', 'market.manage', 'data.export', 'health.view'] },
  { key: 'admin', permissions: ['audit.view', 'routing.manage', 'cms.manage'] },
];

/** i18n key of one permission's label: `admin.team.perms.listings.view`. */
export const permissionLabelKey = (permission) => `admin.team.perms.${permission}`;

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
  // Recording an introduction is leads.manage (app/admin/interactions/actions.js).
  '/admin/interactions': 'leads.view',
  // Every customer → agent contact, one row each, with customers' numbers.
  '/admin/contacts': 'leads.view',
  '/admin/matching': 'analytics.view',
  '/admin/viewings': 'leads.view',
  '/admin/market-data': 'market.view',
  '/admin/investisseurs': 'market.view',
  '/admin/seo': 'market.view',
  '/admin/benchmarks': 'analytics.view',
  '/admin/telemetry': 'analytics.view',
  '/admin/agents': 'agents.view',
  '/admin/agencies': 'agents.view',
  '/admin/customers': 'customers.view',
  // Verification codes in clear, the last hour (2026-11-24): the roles that help customers and agents.
  '/admin/codes': 'customers.manage',
  '/admin/move-projects': 'customers.view',
  // Pasting Facebook group posts adds agent prospects (lib/facebookProspects.js).
  '/admin/prospects': 'agents.manage',
  '/admin/subscriptions': 'billing.view',
  '/admin/billing': 'billing.view',
  '/admin/sales': 'sales.view',
  '/admin/sales/attribution': 'sales.manage',
  '/admin/impersonation': 'audit.view',
  '/admin/demo': 'accounts.demo',
  '/admin/cms': 'cms.manage',
  '/admin/blog': 'blog.manage',
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
  '/admin/campagne': 'partners.view',
  '/admin/liens': 'partners.view',
  '/admin/croissance': 'partners.view',
};

export function sectionPermission(pathname) {
  const match = Object.keys(SECTION_PERMISSIONS)
    .filter((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? SECTION_PERMISSIONS[match] : null;
}

export const ROLE_LABEL_KEYS = Object.fromEntries(ADMIN_ROLES.map((role) => [role, `admin.team.role.${role}`]));
