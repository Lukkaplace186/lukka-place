import { kinshasaDayKey, kinshasaDayStart, slotPhraseFr, toTime } from './visitAgenda';

/**
 * The listing page's visit picker (components/VisitSlotPicker.js), as pure
 * rules: the next seven Kinshasa days, four slots a day, which of them can
 * still be picked. Kinshasa calendar whatever the phone's timezone — a
 * diaspora customer in Brussels books 14h00 in Kinshasa, which is when the
 * agent opens the door.
 *
 * What greys a slot out, and nothing else:
 *  - it starts less than MIN_LEAD_HOURS from now (no one can get there);
 *  - the listing's agent already has a CONFIRMED visit within CLASH_MINUTES of
 *    it (engine busy-slots — instants only).
 * There is no agent working-hours data, so nothing else is blocked and the
 * picker claims no more than that.
 *
 * The engine re-validates the instant (future, ≤ 30 days, with an offset).
 */

export const VISIT_SLOT_HOURS = [9, 11, 14, 16];
export const VISIT_DAYS = 7;
export const MIN_LEAD_HOURS = 2;
export const CLASH_MINUTES = 60;
/** How many listings "Mes visites" can hold — the engine's VISIT_BATCH_MAX. */
export const VISIT_CART_MAX = 4;

const HOUR_MS = 3600 * 1000;

/** `2026-10-03T14:00:00+01:00` — Kinshasa wall time with its offset. */
export function slotIso(dayKey, hour) {
  return `${dayKey}T${String(hour).padStart(2, '0')}:00:00+01:00`;
}

/** The next VISIT_DAYS Kinshasa calendar days, today first, as `YYYY-MM-DD`. */
export function visitDays(now = new Date()) {
  const today = kinshasaDayKey(now);
  const start = kinshasaDayStart(today);
  return Array.from({ length: VISIT_DAYS }, (_, i) => kinshasaDayKey(start + i * 24 * HOUR_MS + 12 * HOUR_MS));
}

/**
 * The four slots of one day.
 * @param {string[]} busy ISO instants of the agent's confirmed visits.
 * @returns {{hour: number, iso: string, disabled: boolean, reason: 'past'|'busy'|null}[]}
 */
export function slotsForDay(dayKey, { now = new Date(), busy = [] } = {}) {
  const busyTimes = busy.map(toTime).filter((t) => t != null);
  const earliest = now.getTime() + MIN_LEAD_HOURS * HOUR_MS;
  return VISIT_SLOT_HOURS.map((hour) => {
    const iso = slotIso(dayKey, hour);
    const at = Date.parse(iso);
    let reason = null;
    if (at < earliest) reason = 'past';
    else if (busyTimes.some((t) => Math.abs(t - at) < CLASH_MINUTES * 60 * 1000)) reason = 'busy';
    return { hour, iso, disabled: reason !== null, reason };
  });
}

/** A day with no slot left to pick is shown, disabled, rather than hidden. */
export function dayHasFreeSlot(dayKey, options) {
  return slotsForDay(dayKey, options).some((slot) => !slot.disabled);
}

/**
 * The form's submitted slot, checked the way the picker built it: a Kinshasa
 * wall time on one of the four hours, within the next seven days, far enough
 * ahead. Returns the ISO string and the French phrase every existing reader
 * (agent alert, dashboard) already shows, or an error code.
 */
export function validatePickedSlot(raw, now = new Date()) {
  const text = String(raw || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):00:00\+01:00$/.exec(text);
  if (!match) return { error: 'invalid' };
  const hour = Number(match[2]);
  if (!VISIT_SLOT_HOURS.includes(hour)) return { error: 'invalid' };
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
