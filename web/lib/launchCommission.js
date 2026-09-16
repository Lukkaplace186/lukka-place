/**
 * The launch sales-rep commission policy (Kinshasa), as pure functions — no
 * database, no `server-only`, so the SQL in lib/salesLaunch.js, the rep
 * dashboard and the unit tests all read the same tiers.
 *
 * THE POLICY IN ONE PARAGRAPH
 *   - A qualified agent: minimum profile + at least 3 credited confirmed
 *     listings + not rejected by LukkaPlace. Only VALIDATED qualified agents
 *     count towards what is payable.
 *   - Acquisition tiers are CUMULATIVE TOTALS (10 agents = $35, not $15 + $35).
 *   - Additional listings = confirmed listings of qualified agents − 3 × qualified
 *     agents, paid on its own cumulative tiers.
 *   - +$25 once, when at least 80% of the rep's credited listings that are 30
 *     days old were still valid on day 30 (and at least 15 were checked, so
 *     1 of 1 cannot earn it).
 *
 * HOW "PAY ONLY THE DIFFERENCE" WORKS
 * Each tier crossing becomes ONE ledger line holding that tier's delta
 * (5 agents → 15, 10 → 20, 15 → 25 …). The sum of a rep's lines is therefore
 * always the cumulative amount of the highest tier reached, a line already
 * paid is never paid again, and the ledger's UNIQUE (source_type, source_id)
 * makes a second run a no-op.
 */

export const LAUNCH_CURRENCY = 'USD';
export const BASELINE_LISTINGS_PER_AGENT = 3;
export const MIN_PHOTOS = 3;
export const QUALITY_BONUS = 25;
export const QUALITY_RATIO = 0.8;
export const QUALITY_MIN_CHECKED = 15;
export const QUALITY_AGE_DAYS = 30;

/** [threshold, cumulative total in USD] — policy §4. */
export const ACQUISITION_TIERS = Object.freeze([[5, 15], [10, 35], [15, 60], [20, 90], [30, 150], [40, 220], [50, 300]]);

/** [threshold, cumulative total in USD] — policy §5. */
export const ADDITIONAL_TIERS = Object.freeze([[10, 5], [25, 15], [50, 35], [100, 80]]);

function wholeCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Where a count stands on a tier table.
 * @returns {{amount: number, reached: number|null, next: {at: number, amount: number, missing: number}|null}}
 */
export function tierFor(tiers, count) {
  const n = wholeCount(count);
  let amount = 0;
  let reached = null;
  let next = null;
  for (const [threshold, total] of tiers) {
    if (n >= threshold) {
      amount = total;
      reached = threshold;
    } else {
      next = { at: threshold, amount: total, missing: threshold - n };
      break;
    }
  }
  return { amount, reached, next };
}

export function acquisitionTier(qualifiedAgents) {
  return tierFor(ACQUISITION_TIERS, qualifiedAgents);
}

export function additionalTier(additionalListings) {
  return tierFor(ADDITIONAL_TIERS, additionalListings);
}

/**
 * Confirmed listings above the 3-per-qualified-agent baseline. `totalConfirmed`
 * must already be limited to QUALIFIED agents' listings: an unqualified agent's
 * one or two listings are neither baseline nor additional.
 */
export function additionalListings(totalConfirmed, qualifiedAgents) {
  return Math.max(0, wholeCount(totalConfirmed) - wholeCount(qualifiedAgents) * BASELINE_LISTINGS_PER_AGENT);
}

/**
 * The ledger lines a tier table produces: one per threshold reached, holding
 * the increase over the previous tier. Summed, they equal the cumulative total.
 * @returns {{threshold: number, delta: number}[]}
 */
export function tierDeltas(tiers) {
  let previous = 0;
  return tiers.map(([threshold, total]) => {
    const delta = Math.round((total - previous) * 100) / 100;
    previous = total;
    return { threshold, delta };
  });
}

/** Lines earned at a given count (what the run would create for it). */
export function linesReached(tiers, count) {
  const n = wholeCount(count);
  return tierDeltas(tiers).filter((line) => n >= line.threshold);
}

/**
 * The 30-day quality test over a rep's CHECKED credits.
 * @param {{checked: number, valid: number}} counts
 */
export function qualityResult({ checked = 0, valid = 0 } = {}) {
  const c = wholeCount(checked);
  const v = Math.min(wholeCount(valid), c);
  const eligible = c >= QUALITY_MIN_CHECKED;
  const ratio = c > 0 ? v / c : null;
  return { eligible, checked: c, valid: v, ratio, passed: eligible && v >= QUALITY_RATIO * c };
}

/**
 * Everything a rep dashboard shows about the launch policy, from counts.
 * `paid` is what the ledger says was already handed over (launch lines only).
 */
export function launchSummary({ qualified = 0, totalConfirmed = 0, quality = {}, qualityEarned = false, paid = 0 } = {}) {
  const acquisition = acquisitionTier(qualified);
  const additionalCount = additionalListings(totalConfirmed, qualified);
  const additional = additionalTier(additionalCount);
  const qualityState = qualityResult(quality);
  const qualityAmount = qualityEarned || qualityState.passed ? QUALITY_BONUS : 0;
  const earned = Math.round((acquisition.amount + additional.amount + qualityAmount) * 100) / 100;
  const paidAmount = Math.round((Number(paid) || 0) * 100) / 100;
  return {
    acquisition,
    additional: { ...additional, count: additionalCount },
    quality: { ...qualityState, amount: qualityAmount },
    earned,
    paid: paidAmount,
    outstanding: Math.round((earned - paidAmount) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Referral codes
// ---------------------------------------------------------------------------

/** 3–10 letters then 2 digits, uppercase: JEAN01, GRACEM07. */
export const REFERRAL_CODE_PATTERN = /^[A-Z]{3,10}[0-9]{2}$/;

/** A typed or linked code, uppercased and stripped; null when it cannot be one. */
export function normaliseReferralCode(value) {
  const text = String(value ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  return REFERRAL_CODE_PATTERN.test(text) ? text : null;
}

/**
 * A code suggestion from a rep's name: the first name's letters (accents
 * folded, 3–10), then 01. `taken` holds codes already in use; the number is
 * incremented until one is free. Null when the name has no usable letters.
 */
export function suggestReferralCode(fullName, taken = []) {
  const letters = String(fullName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Z]/g, ''))
    .find((part) => part.length >= 3);
  if (!letters) return null;
  const stem = letters.slice(0, 10);
  const used = new Set((taken || []).map((code) => String(code).toUpperCase()));
  for (let n = 1; n <= 99; n += 1) {
    const code = `${stem}${String(n).padStart(2, '0')}`;
    if (!used.has(code)) return code;
  }
  return null;
}

/** The two halves of a fortnight in Kinshasa: 1–15 and 16–end of month. */
export function fortnightRange(key) {
  const match = /^(\d{4})-(\d{2})-(1|2)$/.exec(String(key ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  const offset = 60 * 60 * 1000; // Kinshasa is UTC+1, no daylight saving
  const from = match[3] === '1' ? Date.UTC(year, month, 1) : Date.UTC(year, month, 16);
  const to = match[3] === '1' ? Date.UTC(year, month, 16) : Date.UTC(year, month + 1, 1);
  return { from: new Date(from - offset).toISOString(), to: new Date(to - offset).toISOString() };
}

/** The fortnight key containing `now` in Kinshasa, and the previous ones. */
export function recentFortnights(now = new Date(), count = 4) {
  const local = new Date(now.getTime() + 60 * 60 * 1000);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth();
  let half = local.getUTCDate() <= 15 ? 1 : 2;
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(`${year}-${String(month + 1).padStart(2, '0')}-${half}`);
    if (half === 2) half = 1;
    else {
      half = 2;
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
  }
  return keys;
}
