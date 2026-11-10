/**
 * What one approval-queue row shows (/admin/listings, ModerationTable.js).
 * Pure, so the layout's choices are tested without a browser
 * (tests/unit/moderation-row.test.js).
 *
 * The row used to print every quality flag as its own chip, beside the
 * columns that already showed the same fact (a "1–2 photos" chip next to
 * "1 photos", a "far from the median" chip next to "×0.3"), and duplicate
 * flags as two wide link chips. Each fact now appears once, where it belongs:
 * photo count on the thumbnail, the median ratio under the price, the agent's
 * state in the agent cell, and one "possible duplicate" link for all the
 * listings a row matches.
 */
import { DUPLICATE_FLAGS } from '@/lib/moderation';

/** A new account (days) is worth pointing out: its first listings are the ones to read twice. */
export const NEW_ACCOUNT_DAYS = 7;

/** Flags another cell of the row already shows, so the checks column leaves them out. */
export const SHOWN_ELSEWHERE = new Set([
  'no_photos', 'few_photos', // thumbnail badge
  'price_outlier', 'missing_price', // price cell
  'missing_commune', // place line
  'agent_unverified', 'no_agent', // agent cell
  ...DUPLICATE_FLAGS, // one duplicate link
]);

/** The flags left for the checks column, in queue order. */
export function checkFlags(flags = []) {
  return flags.filter((flag) => !SHOWN_ELSEWHERE.has(flag));
}

/**
 * One link for every listing this row matches, whichever flags found them.
 * `danger` only when the same agent has it again (not allowed); a match with
 * another agent is a note (allowed — co-mandate, owner 2026-11-10).
 */
export function duplicateSummary(row) {
  const lists = row?.duplicates || {};
  const ids = [];
  for (const flag of DUPLICATE_FLAGS) {
    if (!row?.flags?.includes(flag)) continue;
    for (const id of lists[flag] || []) if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return null;
  const resend = row.flags.includes('same_agent_resend');
  const sameAgent = resend || (row.flags.includes('duplicate_listing') && Boolean(row.duplicateListingSameAgent)
    && !row.flags.includes('duplicate_photo'));
  return {
    ids,
    sameAgent,
    danger: resend,
    reasons: DUPLICATE_FLAGS.filter((flag) => row.flags.includes(flag)),
  };
}

/** Facts about the agent worth a moderator's eye, from the row's own data. */
export function agentFacts(row, now) {
  const created = row?.agentCreatedAt ? new Date(row.agentCreatedAt).getTime() : null;
  const newAccount = created != null && Number.isFinite(created) && now - created < NEW_ACCOUNT_DAYS * 24 * 3600 * 1000;
  const listingCount = Number.isInteger(row?.agentListingCount) ? row.agentListingCount : null;
  return {
    newAccount,
    firstListing: listingCount != null && listingCount <= 1,
    listingCount,
  };
}

/** The name the row leads with: the person, else the agency, else null (the UI prints "Agent #id"). */
export function agentHeadline(row) {
  return row?.agentName || row?.agentAgency || null;
}

/** The agency line under the name, only when it says something the name does not. */
export function agentSubline(row) {
  if (!row?.agentAgency || !row?.agentName) return null;
  const fold = (value) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  return fold(row.agentAgency) === fold(row.agentName) ? null : row.agentAgency;
}

/** Up to two initials for the avatar; "#" when there is no name. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (!words.length) return '#';
  const letters = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return letters.map((word) => word.match(/[\p{L}\p{N}]/u)[0].toUpperCase()).join('');
}

/** Thumbnail badge tone: none (red), 1–2 (amber), enough (plain). Videos count as media. */
export function photoTone(row) {
  if (row?.flags?.includes('no_photos')) return 'danger';
  if (row?.flags?.includes('few_photos')) return 'warning';
  return 'plain';
}
