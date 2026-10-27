import { createHash } from 'node:crypto';

/**
 * When a customer an agent brought earns that agent a credit (growth plan
 * items 13–14, owner decision 2026-10-27). Pure: lib/referralCredits.js
 * applies it to rows, the tests read it directly. CHANGE THE RULE HERE.
 *
 * A CUSTOMER COUNTS when, within ACTIVATION_WINDOW_DAYS of creating the
 * account:
 *   - their number is verified (a WhatsApp code or message — proof the
 *     number is theirs), and
 *   - they did one real thing: saved a listing, set an alert, or asked for a
 *     visit.
 * The credit is dated by the later of the two.
 *
 * NEVER EARNS (the credit is written VOID with the reason, so the agent page
 * can show why):
 *   - the agent's own number (refused earlier, at the conversion);
 *   - any agent's number — agents are not customers;
 *   - a number that already earned someone a credit (an account deleted and
 *     opened again is not a new customer);
 *   - an account created by the team or while viewing as someone else
 *     (refused at signup, lib/accountAcquisition.js).
 *
 * No daily cap (owner decision). Every credit waits HOLD_DAYS before it can
 * be approved, and flags (referralFlags) are facts for a person — a flag never
 * voids anything by itself.
 */

export const REFERRAL_CREDIT = Object.freeze({ amount: 1, currency: 'USD' });
export const ACTIVATION_WINDOW_DAYS = 14;
export const HOLD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ACTIVATION_KINDS = ['favorite', 'alert', 'visit'];

const asTime = (value) => {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/**
 * @param {{createdAt, verifiedAt, firstFavoriteAt?, firstAlertAt?, firstVisitAt?}} account
 * @param {Date} [now]
 * @returns {{status: 'qualified', qualifiedAt: Date, activation: string}
 *          |{status: 'waiting', until: Date}
 *          |{status: 'expired'}}
 */
export function evaluateActivation(account, now = new Date()) {
  const created = asTime(account?.createdAt);
  if (created == null) return { status: 'expired' };
  const deadline = created + ACTIVATION_WINDOW_DAYS * DAY_MS;
  const inWindow = (time) => time != null && time >= created - 60_000 && time <= deadline;

  const verified = asTime(account.verifiedAt);
  const actions = [
    ['favorite', asTime(account.firstFavoriteAt)],
    ['alert', asTime(account.firstAlertAt)],
    ['visit', asTime(account.firstVisitAt)],
  ].filter(([, time]) => inWindow(time)).sort((a, b) => a[1] - b[1]);

  if (inWindow(verified) && actions.length) {
    const [kind, actionAt] = actions[0];
    return { status: 'qualified', qualifiedAt: new Date(Math.max(verified, actionAt)), activation: kind };
  }
  return now.getTime() <= deadline ? { status: 'waiting', until: new Date(deadline) } : { status: 'expired' };
}

/** When a credit qualified at `qualifiedAt` may be approved. */
export function approvableAt(qualifiedAt) {
  return new Date(asTime(qualifiedAt) + HOLD_DAYS * DAY_MS);
}

/** The digits of a number, hashed: comparable across accounts, never stored in clear. */
export function phoneHash(phone, secret = process.env.ADMIN_SESSION_SECRET || '') {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return createHash('sha256').update(`referral-phone:${secret}:${digits}`).digest('hex');
}

/** Why a qualified customer still earns nothing, or null. */
export function voidReasonFor({ isAgentNumber = false, alreadyCredited = false } = {}) {
  if (isAgentNumber) return 'auto:agent_number';
  if (alreadyCredited) return 'auto:number_already_credited';
  return null;
}

// ---------------------------------------------------------------------------
// Flags for review
// ---------------------------------------------------------------------------

/** Accounts from one connection within a day that make a burst. */
export const BURST_SAME_CONNECTION = 3;
/** Below this activation rate, once enough accounts have had their 14 days. */
export const LOW_ACTIVATION_RATE = 0.3;
export const LOW_ACTIVATION_MIN_ACCOUNTS = 5;

/**
 * @param {{maxSameConnection24h: number, settledAccounts: number, settledActivated: number}} stats
 *   settled = accounts whose activation window has closed.
 * @returns {string[]} flag codes ('burst', 'low_activation')
 */
export function referralFlags({ maxSameConnection24h = 0, settledAccounts = 0, settledActivated = 0 } = {}) {
  const flags = [];
  if (maxSameConnection24h >= BURST_SAME_CONNECTION) flags.push('burst');
  if (settledAccounts >= LOW_ACTIVATION_MIN_ACCOUNTS && settledActivated / settledAccounts < LOW_ACTIVATION_RATE) {
    flags.push('low_activation');
  }
  return flags;
}

/** Money is summed per currency only, never across. */
export function sumByCurrency(rows) {
  const out = {};
  for (const row of rows || []) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    out[row.currency] = Math.round(((out[row.currency] || 0) + amount) * 100) / 100;
  }
  return out;
}
