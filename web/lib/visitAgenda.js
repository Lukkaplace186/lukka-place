/**
 * The agent's visit agenda, as pure functions: when a visit is (in Kinshasa
 * time), how confirmed visits group by day, the directions link, the .ics
 * file, and what the confirm form prefills and accepts.
 *
 * No `server-only`: the confirm form (a client component) needs the same
 * date/time rules the Server Action re-checks, and a rule the browser applies
 * differently from the server is a verdict nobody can be told about — the
 * reason lib/uploadLimits.mjs is shared too.
 *
 * TIME. Kinshasa is UTC+1 all year (no DST). The engine stores `scheduled_at`
 * as UTC with a `Z` (root CLAUDE.md, "`scheduled_at`: where the instant comes
 * from"); everything shown to the agent is Kinshasa wall-clock time whatever
 * the phone's own timezone is set to, because that is the only clock the agent
 * and the customer are meeting by. So day keys and form values are computed by
 * shifting one hour and reading UTC fields, never with the device's local time.
 */

export const KINSHASA_UTC_OFFSET_HOURS = 1;
export const KINSHASA_TIME_ZONE = 'Africa/Kinshasa';
const OFFSET_MS = KINSHASA_UTC_OFFSET_HOURS * 3600 * 1000;
const DAY_MS = 86400000;

/** An ISO instant that names an hour AND an offset — the engine's own rule. */
const ISO_INSTANT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  const raw = String(value).trim();
  // SQLite's `YYYY-MM-DD HH:MM:SS` (created_at) is UTC with no marker.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toTime(value) {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

/** `YYYY-MM-DD` of the Kinshasa calendar day an instant falls on. */
export function kinshasaDayKey(value) {
  const date = toDate(value);
  if (!date) return null;
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Kinshasa calendar day starts. */
export function kinshasaDayStart(dayKey) {
  return Date.parse(`${dayKey}T00:00:00Z`) - OFFSET_MS;
}

/** The confirm form's two fields, in Kinshasa time. */
export function toKinshasaInputs(value) {
  const date = toDate(value);
  if (!date) return { date: '', time: '' };
  const shifted = new Date(date.getTime() + OFFSET_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/**
 * The form's date + time as an ISO instant with Kinshasa's offset
 * (`2026-09-26T14:30:00+01:00`) — what the engine's agent-response route takes
 * as `scheduled_at`. Both fields are required: a day with no hour is refused
 * here exactly as the engine refuses it, never defaulted to a morning.
 * @returns {string|null}
 */
export function fromKinshasaInputs(date, time) {
  const d = String(date || '').trim();
  const t = String(time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number);
  if (hh > 23 || mm > 59) return null;
  const iso = `${d}T${t}:00+01:00`;
  const parsed = new Date(iso);
  // Rejects 2026-02-31 and friends: Date rolls them over rather than failing.
  if (Number.isNaN(parsed.getTime()) || toKinshasaInputs(parsed).date !== d) return null;
  return iso;
}

/**
 * The Server Action's check on a submitted `scheduled_at`. Returns an i18n key
 * rather than a string so this module stays free of the dictionary.
 * @returns {{value: string} | {errorKey: string}}
 */
export function validateAgreedSlot(raw, now = new Date()) {
  const text = String(raw || '').trim();
  if (!text) return { errorKey: 'agent.agenda.confirm.timeRequired' };
  if (!ISO_INSTANT_WITH_OFFSET.test(text) || toTime(text) == null) {
    return { errorKey: 'agent.agenda.confirm.timeInvalid' };
  }
  if (toTime(text) <= now.getTime()) return { errorKey: 'agent.agenda.confirm.timeInPast' };
  return { value: text };
}

/**
 * The instant this request is really about, or null. A RESCHEDULED request's
 * `scheduled_at` is the agent's own proposal; a PENDING one has only the
 * engine's reading of the customer's phrase (`requested_slot_at`, parsed
 * against when they wrote it — routes/admin.js GET /viewing-requests). The
 * phrase is deliberately NOT used for a RESCHEDULED row: it is the agent's
 * proposal by then and was written later than `created_at`.
 */
export function visitSlotAt(visit) {
  if (!visit) return null;
  if (visit.scheduled_at) return toTime(visit.scheduled_at);
  if (visit.status === 'PENDING' && visit.requested_slot_at) return toTime(visit.requested_slot_at);
  return null;
}

/** What the confirm form opens on: the known slot, only while it is still ahead. */
export function confirmPrefill(visit, now = new Date()) {
  const at = visitSlotAt(visit);
  if (at == null || at <= now.getTime()) return null;
  return new Date(at).toISOString();
}

/**
 * A slot written back to the customer as French text — the reschedule
 * proposal is free text by design (root CLAUDE.md), and this is the exact
 * shape the engine's formatSlotFr prints and parseFrenchSlot reads back into
 * `scheduled_at`. The weekday is computed, never typed: the engine's parser
 * trusts a weekday over a date number, so a wrong one would move the visit.
 */
const DAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTH_NAMES_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
export function slotPhraseFr(value) {
  const date = toDate(value);
  if (!date) return null;
  const s = new Date(date.getTime() + OFFSET_MS);
  const hh = String(s.getUTCHours()).padStart(2, '0');
  const mm = String(s.getUTCMinutes()).padStart(2, '0');
  return `${DAY_NAMES_FR[s.getUTCDay()]} ${s.getUTCDate()} ${MONTH_NAMES_FR[s.getUTCMonth()]} à ${hh}h${mm}`;
}

/** Display helpers, always in Kinshasa time. `locale` is 'fr' | 'en'. */
function intlLocale(locale) {
  return locale === 'en' ? 'en-GB' : 'fr-FR';
}
export function formatVisitTime(value, locale = 'fr') {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: KINSHASA_TIME_ZONE, hour: '2-digit', minute: '2-digit',
  }).format(date);
}
export function formatVisitDay(value, locale = 'fr', { long = true } = {}) {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: KINSHASA_TIME_ZONE,
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
  }).format(date);
}
export function formatVisitSlot(value, locale = 'fr') {
  const day = formatVisitDay(value, locale, { long: false });
  const time = formatVisitTime(value, locale);
  return day && time ? `${day} · ${time}` : null;
}

/**
 * Confirmed visits grouped by Kinshasa day.
 *
 *   days        today and later, ascending; each day's visits by time
 *   past        before today, most recent first (the agent still wants last
 *               week's addresses; the UI shows a handful)
 *   unscheduled CONFIRMED with no agreed instant — confirmed before the
 *               dashboard asked for one, or on WhatsApp without a time. Never
 *               placed on a day: requested_time is the customer's phrase, and
 *               the day it names is not an agreement.
 *   week        seven days from today with a real count each, for the strip
 *   today       today's visits
 */
export function groupAgenda(visits = [], now = new Date()) {
  const todayKey = kinshasaDayKey(now);
  const todayStart = kinshasaDayStart(todayKey);
  const scheduled = [];
  const unscheduled = [];
  for (const visit of visits) {
    if (visit?.status !== 'CONFIRMED') continue;
    const at = toTime(visit.scheduled_at);
    if (at == null) unscheduled.push(visit);
    else scheduled.push({ visit, at, key: kinshasaDayKey(at) });
  }
  scheduled.sort((a, b) => a.at - b.at);

  const byDay = new Map();
  const past = [];
  for (const entry of scheduled) {
    if (entry.at < todayStart) {
      past.push(entry.visit);
      continue;
    }
    if (!byDay.has(entry.key)) byDay.set(entry.key, []);
    byDay.get(entry.key).push(entry.visit);
  }
  past.reverse();

  const week = Array.from({ length: 7 }, (_, i) => {
    const key = kinshasaDayKey(todayStart + i * DAY_MS);
    return { key, count: byDay.get(key)?.length || 0, isToday: i === 0, startsAt: kinshasaDayStart(key) };
  });

  return {
    todayKey,
    days: [...byDay.entries()].map(([key, dayVisits]) => ({ key, isToday: key === todayKey, startsAt: kinshasaDayStart(key), visits: dayVisits })),
    past,
    unscheduled,
    week,
    today: byDay.get(todayKey) || [],
  };
}

/**
 * Today's visits the morning banner should still mention: not the ones that
 * finished well before now. A visit an hour into its slot is still "today's
 * visit" to an agent who is running late.
 */
export function todaysRemainingVisits(visits = [], now = new Date()) {
  const { today } = groupAgenda(visits, now);
  return today.filter((v) => toTime(v.scheduled_at) >= now.getTime() - 3600 * 1000);
}

/** A stored coordinate, only when it is a real number inside Earth's range. */
function coordinate(value, limit) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? n : null;
}

/**
 * A Google Maps link to the listing: its stored coordinates when it has real
 * ones, else a text search on address + quartier + commune. Never a made-up
 * point — a listing with neither gets no link. "Kinshasa" is appended to the
 * text so "Bandal" is not resolved to a namesake elsewhere; every commune this
 * product lists is one of Kinshasa's 24.
 */
export function directionsUrl({ lat, lng, address, quartier, commune } = {}) {
  const la = coordinate(lat, 90);
  const ln = coordinate(lng, 180);
  if (la != null && ln != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${la},${ln}`)}`;
  }
  const parts = [address, quartier, commune].map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  if (unique.length === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([...unique, 'Kinshasa'].join(', '))}`;
}

/** The listing's place as one readable line, or null. */
export function placeLine({ address, quartier, commune } = {}) {
  const parts = [address, quartier, commune].map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.length ? unique.join(', ') : null;
}

// ---------------------------------------------------------------------------
// .ics (RFC 5545)
// ---------------------------------------------------------------------------

function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Fold at 75 octets, never inside a UTF-8 character (RFC 5545 §3.1). */
function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  const limit = () => (out.length === 0 ? 75 : 74); // continuation lines start with a space
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > limit()) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * One visit as a calendar file. Only for a CONFIRMED visit with a real
 * `scheduled_at` — the caller refuses anything else rather than exporting a
 * guessed time.
 *
 * No DTEND: nobody agreed how long a visit lasts, and a one-hour block would
 * be a duration we made up. RFC 5545 reads a DATE-TIME DTSTART with no end as
 * an instant, which every calendar app renders. One alarm, an hour before.
 */
export function buildVisitIcs({
  id, scheduledAt, title, customerName, customerPhone, requestedTime, place, directions, listingUrl, dashboardUrl, now = new Date(),
}) {
  const start = toTime(scheduledAt);
  if (start == null) return null;
  const summary = title ? `Visite · ${title}` : 'Visite Lukka Place';
  const description = [
    customerName ? `Client : ${customerName}` : null,
    customerPhone ? `Téléphone : +${String(customerPhone).replace(/\D/g, '')}` : null,
    requestedTime ? `Demande du client : ${requestedTime}` : null,
    directions ? `Itinéraire : ${directions}` : null,
    listingUrl ? `Annonce : ${listingUrl}` : null,
  ].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lukka Place//Agenda agent//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:viewing-request-${id}@lukkaplace.com`,
    `DTSTAMP:${icsUtc(now.getTime())}`,
    `DTSTART:${icsUtc(start)}`,
    `SUMMARY:${icsText(summary)}`,
    place ? `LOCATION:${icsText(place)}` : null,
    description ? `DESCRIPTION:${icsText(description)}` : null,
    dashboardUrl ? `URL:${icsText(dashboardUrl)}` : null,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(summary)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return `${lines.map(fold).join('\r\n')}\r\n`;
}
