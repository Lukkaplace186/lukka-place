'use client';

/**
 * The bridge between the site and the Lukka Place app (Google Play + App
 * Store). One app for agents and customers (owner decision 2026-11-10): a
 * Capacitor shell that loads lukkaplace.com/app. Inside it Capacitor injects
 * `window.Capacitor` with its native plugins, so this site needs no bundled
 * Capacitor code — in a browser every function here is a no-op.
 *
 * Push: ask once for permission, create the Android channel the engine names
 * (`alerts`, services/pushNotify.js fcmMessage), register with Firebase, and
 * hand the token to /api/push/register for the side the page belongs to
 * (`agent` in the agent space, `customer` in the Espace Client). A tapped
 * alert opens its inbox entry — /compte/agent/alertes/<id> or
 * /compte/client/notifications/<id> — which marks it read (cancelling its
 * late WhatsApp copy) and redirects to its page.
 */

export const ALERTS_CHANGED_EVENT = 'lukka:alerts-changed';

function capacitor() {
  if (typeof window === 'undefined') return null;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  return cap;
}

/** True inside the store app, false in any browser. */
export function inNativeApp() {
  return Boolean(capacitor());
}

/** 'android' | 'ios' | null */
export function appPlatform() {
  const platform = capacitor()?.getPlatform?.();
  return platform === 'android' || platform === 'ios' ? platform : null;
}

function pushPlugin() {
  return capacitor()?.Plugins?.PushNotifications || null;
}

function sideOf(value) {
  return value === 'customer' ? 'customer' : 'agent';
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function pushPermission() {
  const plugin = pushPlugin();
  if (!plugin) return 'unsupported';
  try {
    const { receive } = await plugin.checkPermissions();
    if (receive === 'granted' || receive === 'denied') return receive;
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

export function notifyAlertsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
}

// The side of the page that last started push: a token Firebase hands over
// later is registered for that account.
let currentSide = 'agent';

async function sendToken(token) {
  try {
    const response = await fetch('/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, platform: appPlatform(), as: currentSide }),
    });
    return response.ok;
  } catch {
    // Offline: the plugin hands the token again on the next launch.
    return false;
  }
}

/**
 * Where a tapped alert goes: its inbox entry (marks it read), else its page,
 * else the inbox. `data.audience` (set by the engine) says whose.
 */
export function alertTarget(data = {}) {
  const customer = data.audience === 'customer';
  const inbox = customer ? '/compte/client/notifications' : '/compte/agent/alertes';
  const id = Number.parseInt(String(data.notificationId ?? ''), 10);
  if (Number.isSafeInteger(id) && id > 0) return `${inbox}/${id}`;
  const url = typeof data.url === 'string' ? data.url : '';
  const prefixes = customer ? ['/compte/client', '/messages', '/listings', '/projets', '/combien-coute', '/agents'] : ['/compte/agent'];
  return !url.startsWith('//') && prefixes.some((p) => url.startsWith(p)) ? url : inbox;
}

let started = false;

/**
 * Set up push for this side. `ask` false only registers when permission was
 * already granted (the settings card asks explicitly).
 * @returns {Promise<'granted'|'denied'|'prompt'|'unsupported'>}
 */
export async function startAppPush({ ask = true, side = 'agent' } = {}) {
  const plugin = pushPlugin();
  if (!plugin) return 'unsupported';
  currentSide = sideOf(side);

  if (!started) {
    started = true;
    // Listeners first: a tap that launched the app is delivered once one exists.
    plugin.addListener('registration', ({ value }) => {
      if (value) sendToken(value);
    });
    plugin.addListener('registrationError', (err) => {
      console.warn('[app] push registration failed', err?.error || err);
    });
    plugin.addListener('pushNotificationReceived', () => {
      // In the foreground the phone shows nothing; the badge updates instead.
      notifyAlertsChanged();
    });
    plugin.addListener('pushNotificationActionPerformed', (action) => {
      window.location.assign(alertTarget(action?.notification?.data || {}));
    });
  }

  let permission = await pushPermission();
  if (permission === 'prompt' && ask) {
    try {
      const { receive } = await plugin.requestPermissions();
      permission = receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
    } catch {
      permission = 'prompt';
    }
  }
  if (permission !== 'granted') return permission;

  if (appPlatform() === 'android' && typeof plugin.createChannel === 'function') {
    try {
      await plugin.createChannel({ id: 'alerts', name: 'Alertes Lukka Place', importance: 5, visibility: 1, vibration: true });
    } catch {
      // An existing channel is fine.
    }
  }
  try {
    // Firebase hands the token to the 'registration' listener, every launch.
    await plugin.register();
  } catch (err) {
    console.warn('[app] push register failed', err?.message || err);
  }
  return 'granted';
}

/** Stop alerts to this phone for this side (settings card). The server revokes by cookie. */
export async function stopAppPush({ side = 'agent' } = {}) {
  try {
    await fetch('/api/push/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ as: sideOf(side) }),
    });
  } catch {
    // Offline: logout revokes it later.
  }
  try {
    await pushPlugin()?.unregister?.();
  } catch {
    // Nothing to undo.
  }
}
