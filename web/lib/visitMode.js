/**
 * "Sur place" or "Par appel vidéo" (2026-11-16, owner): how a customer wants
 * to visit. A customer abroad — Paris, Brussels, Washington — asks the agent
 * to show the property on a WhatsApp video call at the booked time.
 *
 * Stored by the engine on the visit request (`viewing_requests.visit_mode`,
 * engine services/visitMode.js): 'in_person' | 'video', NULL on older rows
 * (= in person). Whether an agent takes video visits is their own switch
 * (lib/agentAvailability.js `videoVisits`, on by default).
 *
 * The visitor's clock: a video visit's time is the listing's local time
 * (Kinshasa +1, Lubumbashi +2…). Someone booking from Paris sees it next to
 * their own time when the two differ — « 10:00 à Kinshasa · 10:00 à Paris ».
 * The zone is the browser's (`Intl`), never guessed from the phone number.
 *
 * Pure module: shared by the dialog, the Server Action and the tests.
 */

export const VISIT_MODES = Object.freeze(['in_person', 'video']);

/** The owner's wording, shown with every video booking. */
export const VIDEO_PAYMENT_WARNING_FR = 'Ne versez aucun argent sur la seule base d’une vidéo.';

/** 'in_person' | 'video' from a posted form; anything else is in person. */
export function visitModeFromForm(formData) {
  const raw = String(formData?.get?.('visit_mode') || '').trim();
  return VISIT_MODES.includes(raw) ? raw : 'in_person';
}

export function isVideoVisit(row) {
  return row?.visit_mode === 'video';
}

/** The browser's IANA zone ("Europe/Paris"), or null when it cannot say. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Minutes east of UTC of `timeZone` at `date` (Paris in winter: 60). Null when unknown. */
export function zoneOffsetMinutes(timeZone, date) {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const whole = Math.floor(date.getTime() / 60000) * 60000;
    return Math.round((asUtc - whole) / 60000);
  } catch {
    return null;
  }
}

/** "Europe/Paris" → "Paris", "America/New_York" → "New York". */
export function zoneCity(timeZone) {
  const last = String(timeZone || '').split('/').pop();
  return last ? last.replace(/_/g, ' ') : null;
}

/** "10:00" in `timeZone` at `iso`, 24-hour, or null. */
export function timeInZone(iso, timeZone) {
  const date = new Date(iso);
  if (!timeZone || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  } catch {
    return null;
  }
}

/** "10:00" at a fixed UTC offset (the listing's own clock: +1 Kinshasa, +2 Lubumbashi…). */
export function timeAtOffset(iso, offsetHours = 1) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + offsetHours * 3600000);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The visitor's own clock for a slot, when it differs from the listing's:
 * `{ time: '11:00', city: 'Paris', dayShift: 0 }`, or null when the visitor
 * is on the listing's clock (Kinshasa from Kinshasa) or the zone is unknown.
 * `dayShift` is -1 / +1 when the visitor's date is the day before / after.
 *
 * @param {string} iso the slot instant
 * @param {{listingOffsetHours?: number, timeZone?: string|null}} [options]
 */
export function visitorClock(iso, { listingOffsetHours = 1, timeZone = browserTimeZone() } = {}) {
  const date = new Date(iso);
  if (!timeZone || Number.isNaN(date.getTime())) return null;
  const visitorOffset = zoneOffsetMinutes(timeZone, date);
  if (visitorOffset == null || visitorOffset === listingOffsetHours * 60) return null;
  const time = timeInZone(iso, timeZone);
  if (!time) return null;
  const dayOf = (offsetMinutes) => Math.floor((date.getTime() + offsetMinutes * 60000) / 86400000);
  const dayShift = dayOf(visitorOffset) - dayOf(listingOffsetHours * 60);
  return { time, city: zoneCity(timeZone), dayShift };
}
