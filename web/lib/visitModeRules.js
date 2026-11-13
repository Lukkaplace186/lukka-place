// "Sur place / En vidéo" on the app's visit booking (2026-11-13). Pure, shared
// by the booking screen and the server action, and unit-tested.

/** The modes the engine knows (services/db.js VISIT_MODES). */
export const VISIT_MODES = Object.freeze(['video']);

/** 'video' or null. Anything else posted by a form is not a mode: on site. */
export function visitModeOf(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VISIT_MODES.includes(mode) ? mode : null;
}

/** What the agent reads after the time, in French always (the agent is in the DRC). */
export const VIDEO_PHRASE = '(appel vidéo WhatsApp)';

/**
 * The phrase sent to the engine as `requested_time`. Every alert already
 * prints that phrase, so a video request says so on the agent's first
 * message without a new template. Never added twice.
 */
export function requestedTimeWithMode(phrase, mode) {
  const text = String(phrase || '').trim();
  if (mode !== 'video' || !text || text.includes(VIDEO_PHRASE)) return text;
  return `${text} ${VIDEO_PHRASE}`.slice(0, 200);
}

/**
 * The picked instant on THIS device's clock ("13:00"), or null when the
 * device shows the same wall time as the calendar did — the calendar is on
 * the listing's clock (Kinshasa, UTC+1, unless `listingOffsetHours` says
 * otherwise), so a customer in London needs both. Browser only in practice:
 * `deviceOffsetMinutes` is injectable for tests.
 */
export function deviceTimeNote(iso, locale = 'fr', { listingOffsetHours = 1, deviceOffsetMinutes = null } = {}) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  // getTimezoneOffset() is minutes BEHIND UTC; flip it to minutes ahead.
  const ahead = deviceOffsetMinutes == null ? -at.getTimezoneOffset() : deviceOffsetMinutes;
  if (ahead === listingOffsetHours * 60) return null;
  const local = new Date(at.getTime() + ahead * 60000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return locale === 'en' ? `${hh}:${mm}` : `${local.getUTCHours()} h${mm === '00' ? '' : ` ${mm}`}`;
}
