/**
 * Pure rules for the Lukka Place app's push notifications (no DB, no DOM).
 *
 * One app for agents and customers (owner decision 2026-11-10): a Capacitor
 * shell around lukkaplace.com that starts at /app. It registers its Firebase
 * Cloud Messaging token through /api/push/register for the side the person is
 * signed in on. The engine (services/pushNotify.js) sends the pushes and
 * fills `notifications`, each account's in-app inbox. Root
 * docs/claude/whatsapp-delivery.md, "App alerts".
 */

export const PUSH_PLATFORMS = Object.freeze(['android', 'ios']);
export const PUSH_USER_TYPES = Object.freeze(['agent', 'customer']);

/** FCM tokens are ~150–200 characters; the column allows 20–4096. */
export const TOKEN_MIN = 20;
export const TOKEN_MAX = 4096;

/** The cookie the app writes so logout can revoke this phone's token. */
export const PUSH_TOKEN_COOKIE = 'lukka_push_token';

export const INBOX_PAGE_SIZE = 30;

/**
 * The kinds of customer alert a person can switch off in the app
 * (notification_preferences.category). The engine passes the same strings.
 * Visits cannot be switched off: a confirmed or cancelled visit is not a
 * marketing message.
 */
export const CUSTOMER_CATEGORIES = Object.freeze([
  { key: 'visits', labelKey: 'account.notifications.categories.visits', locked: true },
  { key: 'requests', labelKey: 'account.notifications.categories.requests' },
  { key: 'messages', labelKey: 'account.notifications.categories.messages' },
  { key: 'search_alerts', labelKey: 'account.notifications.categories.searchAlerts' },
  { key: 'saved_listings', labelKey: 'account.notifications.categories.savedListings' },
  { key: 'suggestions', labelKey: 'account.notifications.categories.suggestions' },
  { key: 'news', labelKey: 'account.notifications.categories.news' },
]);

/** A category a customer may switch off, else null. */
export function switchableCustomerCategory(value) {
  const found = CUSTOMER_CATEGORIES.find((c) => c.key === value);
  return found && !found.locked ? found.key : null;
}

/** 'agent' | 'customer' from a request value; anything else is the agent's (part 1's default). */
export function parseSide(value) {
  return value === 'customer' ? 'customer' : 'agent';
}

/**
 * A registration body, or null when it is not one.
 * @returns {{token: string, platform: 'android'|'ios', appVersion: string|null}|null}
 */
export function parseRegistration(body) {
  if (!body || typeof body !== 'object') return null;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (token.length < TOKEN_MIN || token.length > TOKEN_MAX || /\s/.test(token)) return null;
  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
  if (!PUSH_PLATFORMS.includes(platform)) return null;
  const rawVersion = typeof body.appVersion === 'string' ? body.appVersion.trim() : '';
  const appVersion = rawVersion && /^[\w.+-]{1,40}$/.test(rawVersion) ? rawVersion : null;
  return { token, platform, appVersion };
}

function cleanPath(url) {
  const text = typeof url === 'string' ? url.trim() : '';
  if (!text.startsWith('/') || text.startsWith('//') || /[\s\\]/.test(text)) return null;
  return text;
}

/**
 * Where a tapped agent alert may send the agent: a path inside the agent
 * space only. Anything else (another site, a protocol-relative URL, a public
 * page a stored row somehow names) opens the inbox instead.
 */
export function safeAgentPath(url) {
  const text = cleanPath(url);
  return text && text.startsWith('/compte/agent') ? text : '/compte/agent/alertes';
}

const CUSTOMER_PATH_PREFIXES = ['/compte/client', '/messages', '/listings'];

/** The same for a customer: their portal, their conversations, or a listing page. */
export function safeCustomerPath(url) {
  const text = cleanPath(url);
  const ok = text && CUSTOMER_PATH_PREFIXES.some((prefix) => text === prefix || text.startsWith(`${prefix}/`) || text.startsWith(`${prefix}?`));
  return ok ? text : '/compte/client/notifications';
}

/** A positive integer id from a route param or body value, else null. */
export function parseId(value) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(n) && n > 0 && String(n) === String(value).trim() ? n : null;
}

/** The inbox's "before" cursor: a positive id, else null (first page). */
export function parseCursor(value) {
  return parseId(value);
}
