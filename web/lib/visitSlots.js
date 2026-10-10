import { kinshasaDayKey, kinshasaDayStart, slotPhraseFr, toTime } from './visitAgenda';

/**
 * The visit calendar (components/VisitSlotPicker.js), as pure rules: the next
 * fourteen Kinshasa days, a time every quarter of an hour from 08:00 to 20:00,
 * which of them can still be picked. (Four fixed slots a day until
 * 2026-10-10 — "only a few hours available, why?".) Kinshasa calendar whatever the phone's timezone — a
 * diaspora customer in Brussels books 14h00 in Kinshasa, which is when the
 * agent opens the door.
 *
 * What greys a slot out, and nothing else:
 *  - it starts less than MIN_LEAD_HOURS from now (no one can get there);
 *  - the listing's agent already has a CONFIRMED visit within CLASH_MINUTES of
 *    it (engine busy-slots — instants only);
 *  - the agent marked that weekday or that date as a day without visits
 *    (lib/agentAvailability.js, set on their agenda page).
 * An agent who set nothing blocks nothing, and the picker claims no more than
 * that: a free slot is a slot nobody said no to, confirmed only by the agent.
 *
 * The engine re-validates the instant (future, ≤ 30 days, with an offset).
 */

export const VISIT_FIRST_HOUR = 8;
export const VISIT_LAST_HOUR = 20;
export const VISIT_STEP_MINUTES = 15;
/** '08:00', '08:15', … '20:00' (product decision, 2026-10-10); the last visit STARTS at 20:00. */
export const VISIT_SLOT_TIMES = (() => {
  const times = [];
  for (let m = VISIT_FIRST_HOUR * 60; m <= VISIT_LAST_HOUR * 60; m += VISIT_STEP_MINUTES) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return times;
})();
export const VISIT_DAYS = 14;
export const MIN_LEAD_HOURS = 2;
export const CLASH_MINUTES = 60;
/** How many listings "Mes visites" can hold — the engine's VISIT_BATCH_MAX. */
export const VISIT_CART_MAX = 4;

const HOUR_MS = 3600 * 1000;

/** `2026-10-03T14:15:00+01:00` — Kinshasa wall time with its offset. `time` is 'HH:MM' (a bare hour still works). */
export function slotIso(dayKey, time) {
  const text = typeof time === 'number' ? `${String(time).padStart(2, '0')}:00` : String(time);
  return `${dayKey}T${text}:00+01:00`;
}

/** The next VISIT_DAYS Kinshasa calendar days, today first, as `YYYY-MM-DD`. */
export function visitDays(now = new Date()) {
  const today = kinshasaDayKey(now);
  const start = kinshasaDayStart(today);
  return Array.from({ length: VISIT_DAYS }, (_, i) => kinshasaDayKey(start + i * 24 * HOUR_MS + 12 * HOUR_MS));
}

/** 0 (Sunday) … 6 (Saturday) for a Kinshasa `YYYY-MM-DD`. */
export function weekdayOf(dayKey) {
  return new Date(`${dayKey}T12:00:00+01:00`).getUTCDay();
}

/**
 * An agent's "no visits" settings, cleaned: weekdays 0..6 once each, dates as
 * `YYYY-MM-DD`. Anything else is dropped, so a malformed row blocks nothing.
 * @returns {{closedWeekdays: number[], blockedDates: string[]}}
 */
export function normaliseAvailability(raw) {
  const weekdays = Array.isArray(raw?.closedWeekdays) ? raw.closedWeekdays : [];
  const dates = Array.isArray(raw?.blockedDates) ? raw.blockedDates : [];
  return {
    closedWeekdays: [...new Set(weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    blockedDates: [...new Set(dates.map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(),
  };
}

/** The agent takes no visits that day (their weekday off, or a date they blocked). */
export function dayClosed(dayKey, availability) {
  const { closedWeekdays, blockedDates } = normaliseAvailability(availability);
  return blockedDates.includes(dayKey) || closedWeekdays.includes(weekdayOf(dayKey));
}

/**
 * Every time of one day.
 * @param {string[]} busy ISO instants of the agent's confirmed visits.
 * @param {{closedWeekdays?: number[], blockedDates?: string[]}} availability
 * @returns {{time: string, iso: string, disabled: boolean, reason: 'past'|'busy'|'closed'|null}[]}
 */
export function slotsForDay(dayKey, { now = new Date(), busy = [], availability = null } = {}) {
  const busyTimes = busy.map(toTime).filter((t) => t != null);
  const earliest = now.getTime() + MIN_LEAD_HOURS * HOUR_MS;
  const closed = availability ? dayClosed(dayKey, availability) : false;
  return VISIT_SLOT_TIMES.map((time) => {
    const iso = slotIso(dayKey, time);
    const at = Date.parse(iso);
    let reason = null;
    if (at < earliest) reason = 'past';
    else if (closed) reason = 'closed';
    else if (busyTimes.some((t) => Math.abs(t - at) < CLASH_MINUTES * 60 * 1000)) reason = 'busy';
    return { time, iso, disabled: reason !== null, reason };
  });
}

/** A day with no slot left to pick is shown, disabled, rather than hidden. */
export function dayHasFreeSlot(dayKey, options) {
  return slotsForDay(dayKey, options).some((slot) => !slot.disabled);
}

/**
 * The bookable days laid out as calendar weeks, Monday first: each row is
 * seven cells, a `YYYY-MM-DD` inside the window or null outside it (the days
 * of the first week already gone, the tail of the last week).
 * @returns {(string|null)[][]}
 */
export function calendarWeeks(now = new Date()) {
  const days = visitDays(now);
  const lead = (weekdayOf(days[0]) + 6) % 7; // Monday = 0
  const cells = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * The form's submitted slot, checked the way the picker built it: a Kinshasa
 * wall time on one of the offered quarter-hours, within the bookable window,
 * far enough ahead. Returns the ISO string and the French phrase every existing reader
 * (agent alert, dashboard) already shows, or an error code.
 */
export function validatePickedSlot(raw, now = new Date()) {
  const text = String(raw || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00\+01:00$/.exec(text);
  if (!match) return { error: 'invalid' };
  if (!VISIT_SLOT_TIMES.includes(match[2])) return { error: 'invalid' };
  if (!visitDays(now).includes(match[1])) return { error: 'out_of_range' };
  if (Date.parse(text) < now.getTime() + MIN_LEAD_HOURS * HOUR_MS) return { error: 'too_soon' };
  return { iso: text, phrase: slotPhraseFr(text) };
}

/** Two picks less than CLASH_MINUTES apart — "Mes visites" warns, it does not refuse. */
export function tightPairs(isos = []) {
  const times = isos.map((iso) => ({ iso, at: Date.parse(iso) })).filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
  const pairs = [];
  for (let i = 1; i < times.length; i += 1) {
    if (times[i].at - times[i - 1].at < CLASH_MINUTES * 60 * 1000) pairs.push([times[i - 1].iso, times[i].iso]);
  }
  return pairs;
}
