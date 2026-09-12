/**
 * services/visitSchedule.js
 *
 * Turns what an agent actually types — "demain 14h", "samedi matin", "le 15 à
 * 10h" — into a real instant, so the post-visit check-in has something to
 * count two hours forward from.
 *
 * WHY THIS EXISTS AT ALL
 * `viewing_requests.requested_time` is free text and stays that way: it is
 * what the CUSTOMER asked for, and "demain matin" is a real answer that must
 * not be forced into a picker. But a 2-hour post-visit check-in cannot be
 * scheduled off a phrase, so the AGENT's confirmation is captured separately
 * in `scheduled_at` as an actual timestamp.
 *
 * PROPOSE, NEVER ASSUME
 * Nothing here writes a schedule on its own. The parse produces a PROPOSAL
 * that the agent confirms or corrects with a tap
 * (services/viewingNotifications.js's accept flow). That is what makes a
 * lenient parser safe: the cost of a wrong guess is one extra tap, not a
 * customer asked "how was your visit?" about a visit that has not happened.
 *
 * A parse returns null rather than guessing when it cannot find BOTH a day
 * and a time. "demain" alone is a day with no hour, and inventing one — 9am?
 * noon? — would produce a confident-looking slot nobody agreed to. Asking is
 * better than defaulting.
 *
 * TIMEZONE
 * Kinshasa is UTC+1 year-round (no DST, so there is no transition to get
 * wrong). The offset is applied once, here, and the result is serialised as
 * UTC with a `Z` — see the `scheduled_at` note in services/db.js for why the
 * column must not hold mixed offsets.
 */

/** Kinshasa, UTC+1, no daylight saving. */
const KINSHASA_UTC_OFFSET_HOURS = 1;

/** Monday-first is how the weekday words below are indexed. */
const WEEKDAYS = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

const MONTHS = {
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,
};

/**
 * Parts of the day, as hours.
 *
 * These are conventions, not guesses: an agent writing "matin" means a
 * morning appointment, and 10:00 is the middle of a Kinshasa working morning.
 * The agent still confirms the concrete hour, so a reading of "matin" as
 * 10:00 that they meant as 08:00 costs one tap.
 *
 * ORDER MATTERS and is most-specific-first, the same rule
 * services/viewingNotifications.js's parseDeclineReason follows: "midi" is a
 * substring of "apres-midi", so a loop that tested it first would read
 * "cet après-midi" as noon.
 */
const DAY_PARTS = [
  ['apres-midi', 15],
  ['apresmidi', 15],
  ['apres midi', 15],
  ['matinee', 10],
  ['matin', 10],
  ['soiree', 18],
  ['soir', 18],
  ['midi', 12],
];

/** Lowercase, strip accents, normalise separators — one shape to match against. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The Kinshasa wall-clock date parts of an instant. */
function kinshasaParts(date) {
  const shifted = new Date(date.getTime() + KINSHASA_UTC_OFFSET_HOURS * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** A Kinshasa wall clock back to a real UTC instant. */
function fromKinshasa({ year, month, day, hour, minute }) {
  return new Date(Date.UTC(year, month, day, hour - KINSHASA_UTC_OFFSET_HOURS, minute, 0, 0));
}

/**
 * The hour and minute, if the text names one.
 *
 * Handles "14h", "14h30", "14:30", "14 h 30", "a 9h", and the day-part words.
 * An explicit clock time always wins over a day part, so "samedi matin 11h"
 * is 11:00 rather than 10:00.
 */
function findTime(text) {
  const clock = text.match(/(?:^|\D)(\d{1,2})\s*(?:h|:)\s*(\d{2})?/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = clock[2] ? Number(clock[2]) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute, source: 'clock' };
    }
  }

  for (const [word, hour] of DAY_PARTS) {
    if (text.includes(word)) return { hour, minute: 0, source: 'daypart' };
  }
  return null;
}

/**
 * The calendar day, if the text names one.
 *
 * Relative words first ("demain"), then a weekday name, then a numeric or
 * written date. A weekday always resolves FORWARD — "samedi" said on a
 * Saturday means the next one, not today, because an agent confirming a slot
 * is proposing a future appointment.
 */
function findDay(text, now) {
  const today = kinshasaParts(now);
  const base = { year: today.year, month: today.month, day: today.day };

  const shiftDays = (n) => {
    const d = new Date(Date.UTC(base.year, base.month, base.day));
    d.setUTCDate(d.getUTCDate() + n);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
  };

  if (/\bapres[- ]demain\b/.test(text)) return shiftDays(2);
  if (/\bdemain\b/.test(text)) return shiftDays(1);
  if (/\b(aujourd'hui|ce jour)\b/.test(text)) return shiftDays(0);
  // "ce soir" / "ce matin" / "cet apres-midi" name a day AND a time. They are
  // not the "demain with no hour" case this module refuses to guess at — the
  // day part IS the hour, and the day is today.
  if (/\b(ce (soir|matin|midi)|cet(?:te)? (apres[- ]?midi|matinee|soiree))\b/.test(text)) {
    return shiftDays(0);
  }

  for (const [word, index] of Object.entries(WEEKDAYS)) {
    if (!new RegExp(`\\b${word}\\b`).test(text)) continue;
    let delta = (index - today.weekday + 7) % 7;
    // "samedi" on a Saturday means next Saturday. A slot in the past is not a
    // slot.
    if (delta === 0) delta = 7;
    return shiftDays(delta);
  }

  // "15/09", "15/09/2026", "15-09"
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = numeric[3] ? Number(numeric[3]) : base.year;
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return { year, month, day };
    }
  }

  // "le 15 septembre", "15 septembre"
  const written = text.match(/\b(\d{1,2})\s+([a-z]+)\b/);
  if (written && MONTHS[written[2]] !== undefined) {
    const day = Number(written[1]);
    if (day >= 1 && day <= 31) {
      return { year: base.year, month: MONTHS[written[2]], day };
    }
  }

  // "le 15" — this month, or next if that day has already passed.
  const bare = text.match(/\ble\s+(\d{1,2})\b/);
  if (bare) {
    const day = Number(bare[1]);
    if (day >= 1 && day <= 31) {
      if (day >= base.day) return { year: base.year, month: base.month, day };
      const next = new Date(Date.UTC(base.year, base.month + 1, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth(), day };
    }
  }

  return null;
}

/**
 * Parse a free-text slot into a real instant.
 *
 * @param {string} requestedTime What the customer or agent wrote.
 * @param {Date}   [now] The instant to resolve relative words against.
 *                 Injectable so tests never depend on the wall clock.
 * @returns {{iso: string, hour: number, minute: number, confidence: 'clock'|'daypart'}|null}
 *          `iso` is UTC (…Z). null when no day AND time could be found — the
 *          caller must then ASK rather than assume.
 */
function parseFrenchSlot(requestedTime, now = new Date()) {
  const text = normalise(requestedTime);
  if (!text) return null;

  const day = findDay(text, now);
  if (!day) return null;

  const time = findTime(text);
  if (!time) return null;

  const when = fromKinshasa({ ...day, hour: time.hour, minute: time.minute });
  if (Number.isNaN(when.getTime())) return null;

  // A slot in the past is a misparse, not an appointment. "lundi 9h" typed on
  // Monday at 14:00 resolves forward by findDay; this catches what is left,
  // such as an explicit date that has already gone by.
  if (when.getTime() <= now.getTime()) return null;

  return {
    iso: when.toISOString(),
    hour: time.hour,
    minute: time.minute,
    confidence: time.source,
  };
}

/**
 * How a proposed slot is read back to the agent for confirmation.
 *
 * Always the full day and date, never "demain": the agent is being asked to
 * confirm, and "demain" read a day later than it was sent confirms the wrong
 * day. Rendered in Kinshasa local time, which is the only clock either party
 * is thinking in.
 */
function formatSlotFr(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = kinshasaParts(date);
  const shifted = new Date(date.getTime() + KINSHASA_UTC_OFFSET_HOURS * 3600 * 1000);
  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const monthNames = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${dayNames[parts.weekday]} ${parts.day} ${monthNames[parts.month]} à ${hh}h${mm}`;
}

module.exports = {
  parseFrenchSlot,
  formatSlotFr,
  KINSHASA_UTC_OFFSET_HOURS,
  // Exposed for scripts/verify-pipeline.js.
  normalise,
  findDay,
  findTime,
};
