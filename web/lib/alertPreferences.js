/**
 * How often a saved search may WhatsApp its owner. Plain module (no
 * server-only): the sweep's SQL, the server action's validation and the
 * Alertes tab's picker all read the same list.
 *
 * 'weekly' is the default because it is what every search had before the
 * choice existed (migrations/20260918_customer_alert_preferences.sql).
 */
export const ALERT_FREQUENCIES = ['daily', 'weekly', 'off'];
export const DEFAULT_ALERT_FREQUENCY = 'weekly';

// Keys, not text — see components/navItems.js.
export const ALERT_FREQUENCY_LABEL_KEYS = {
  daily: 'account.alerts.frequency.daily',
  weekly: 'account.alerts.frequency.weekly',
  off: 'account.alerts.frequency.off',
};

/** Longest label a customer may give an alert — it is quoted in a WhatsApp message. */
export const MAX_ALERT_LABEL_LENGTH = 120;
