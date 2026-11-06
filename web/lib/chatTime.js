/**
 * Messagerie — dates and times, always on Kinshasa's clock.
 *
 * Every label is computed with an explicit `timeZone`, so the server's
 * render (UTC on the VPS) and the browser's hydration print the same thing
 * — a "10:42" that became "11:42" after hydration is React error #418, the
 * one lib/listings.js avoids for "Nouveau" by computing it in SQL. "Today"
 * is relative to a `now` the page passes down from the server for the first
 * render, then to the browser's clock.
 *
 * Kinshasa time for everyone, the diaspora included: it is when the agent
 * wrote, and visits are arranged on that clock.
 */

export const CHAT_TIME_ZONE = 'Africa/Kinshasa';

const formatters = new Map();

function formatter(locale, options) {
  const tag = locale === 'en' ? 'en-GB' : 'fr-FR';
  const key = `${tag}|${JSON.stringify(options)}`;
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(tag, { timeZone: CHAT_TIME_ZONE, ...options }));
  return formatters.get(key);
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 'YYYY-MM-DD' of an instant, on Kinshasa's calendar. */
export function chatDayKey(value) {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: CHAT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Whole days between two Kinshasa calendar days (b − a). */
function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "10:42" — 24-hour, both languages. */
export function chatClock(value, locale = 'fr') {
  const date = toDate(value);
  return date ? formatter(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '';
}

/**
 * The divider between days in a conversation: "Aujourd'hui", "Hier", else
 * "mardi 4 novembre" (the year only when it is not this year).
 */
export function chatDayLabel(value, now, locale, t) {
  const day = chatDayKey(value);
  const today = chatDayKey(now);
  if (!day || !today) return '';
  const diff = dayDiff(day, today);
  if (diff === 0) return t('chat.time.today');
  if (diff === 1) return t('chat.time.yesterday');
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return formatter(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(toDate(value));
}

/**
 * The inbox's time column: "10:42" today, "hier", a short weekday within the
 * week ("lun."), else "28 oct." (with the year when it is not this year).
 */
export function chatInboxTime(value, now, locale, t) {
  const day = chatDayKey(value);
  const today = chatDayKey(now);
  if (!day || !today) return '';
  const diff = dayDiff(day, today);
  if (diff <= 0) return chatClock(value, locale);
  if (diff === 1) return t('chat.time.yesterdayShort');
  const date = toDate(value);
  if (diff < 7) return formatter(locale, { weekday: 'short' }).format(date);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return formatter(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}

/**
 * How long something has waited, short: "12 min", "2 h", "3 j" ("3 d" in
 * English). Under a minute reads "1 min" — the chip only shows on a wait.
 */
export function chatWaitLabel(since, now, locale = 'fr') {
  const from = toDate(since);
  const to = toDate(now);
  if (!from || !to) return '';
  const minutes = Math.max(1, Math.floor((to - from) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} ${locale === 'en' ? 'd' : 'j'}`;
}

/** "octobre 2026" — when a customer joined, for the agent's side panel. */
export function chatMonthYear(value, locale = 'fr') {
  const date = toDate(value);
  return date ? formatter(locale, { month: 'long', year: 'numeric' }).format(date) : '';
}

/** "5 novembre 2026". */
export function chatLongDate(value, locale = 'fr') {
  const date = toDate(value);
  return date ? formatter(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date) : '';
}
