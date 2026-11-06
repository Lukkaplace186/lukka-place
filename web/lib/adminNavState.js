/**
 * The console sidebar's folding and badge rules, as pure functions (no DOM,
 * no React) so they are unit-tested and the sidebar stays a thin renderer.
 *
 * - Groups fold. Opérations and the group holding the current page are open
 *   by default; a person's own open/closed choices are remembered in this
 *   browser (OPEN_GROUPS_STORAGE_KEY) and win over the default, except that
 *   the current page's group always opens when you land on it.
 * - A badge is URGENT (red) when the queue behind it means someone is waiting
 *   on us; anything else that merely needs a look is QUIET. A folded group
 *   shows the sum of its urgent badges, so work never hides behind a fold.
 */

export const OPEN_GROUPS_STORAGE_KEY = 'lukka_admin_nav_open';

/** The group open when nothing else says otherwise. */
export const DEFAULT_OPEN_GROUP = 'admin.nav.groups.operations';

/** The section pinned above the groups. */
export const PINNED_HREF = '/admin/dashboard';

/** Which live work-queue count (lib/adminWorkQueues.js) badges which item. */
export const BADGE_FOR = {
  '/admin/listings': 'pendingListings',
  '/admin/projets': 'projectsToReview',
  '/admin/viewings': 'escalatedViewings',
  '/admin/conversations': 'humanConversations',
  '/admin/subscriptions': 'pendingPlanRequests',
  '/admin/agents': 'unverifiedAgents',
  // Open ops incidents (services/opsAlerts.js) — where an alert lands when no
  // desk number is configured to receive it.
  '/admin/health': 'openAlerts',
};

/**
 * Counts that mean somebody is waiting on the team: the same queues the
 * dashboard's work-queue cards mark `urgent`, plus open ops incidents.
 */
export const URGENT_COUNTS = new Set(['pendingListings', 'escalatedViewings', 'humanConversations', 'openAlerts']);

export function isActiveHref(pathname, href) {
  if (!pathname || !href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A positive integer count, else 0 (null, "—", NaN and negatives count as nothing). */
export function badgeValue(counts, href) {
  const key = BADGE_FOR[href];
  if (!key || !counts) return 0;
  const value = Number(counts[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function badgeTone(href) {
  return URGENT_COUNTS.has(BADGE_FOR[href]) ? 'urgent' : 'quiet';
}

/** The sum of a group's urgent badges — what a folded group shows in red. */
export function urgentTotal(items, counts) {
  return items.reduce((sum, { href }) => (badgeTone(href) === 'urgent' ? sum + badgeValue(counts, href) : sum), 0);
}

/** Parse what the browser stored; anything unreadable is "nothing stored". */
export function parseStoredOpenGroups(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((key) => typeof key === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Which groups are open: the stored choice when there is one, else the
 * default group; the group holding the current page is always added.
 *
 * @param {Array<{labelKey: string, items: Array<{href: string}>}>} groups
 * @param {string} pathname
 * @param {string[] | null} stored
 * @returns {string[]}
 */
export function initialOpenGroups(groups, pathname, stored) {
  const known = new Set(groups.map((group) => group.labelKey));
  const base = stored ? stored.filter((key) => known.has(key)) : known.has(DEFAULT_OPEN_GROUP) ? [DEFAULT_OPEN_GROUP] : [];
  const current = groups.find((group) => group.items.some(({ href }) => isActiveHref(pathname, href)));
  return current && !base.includes(current.labelKey) ? [...base, current.labelKey] : base;
}

export function toggleOpenGroup(open, key) {
  return open.includes(key) ? open.filter((k) => k !== key) : [...open, key];
}
