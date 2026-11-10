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

/** At least this many photos for a listing to go straight to "Prêtes". */
export const READY_MIN_PHOTOS = 3;

/**
 * "ready" (Prêtes: one tap approves them all) or "check" (À vérifier: one by
 * one in review mode). Ready = a verified agent whose account is older than
 * NEW_ACCOUNT_DAYS, no quality flag at all, at least READY_MIN_PHOTOS photos.
 * Anything unknown is "check".
 */
export function readiness(row, now) {
  if (!row?.agentId || !row.agentVerified) return 'check';
  if (!row.agentCreatedAt || agentFacts(row, now).newAccount) return 'check';
  if ((row.flags || []).length > 0) return 'check';
  if (!(Number(row.photoCount) >= READY_MIN_PHOTOS)) return 'check';
  return 'ready';
}

/** Rows split for the pending tab, each group keeping the queue's order. */
export function splitQueue(rows, now) {
  const check = [];
  const ready = [];
  for (const row of rows || []) (readiness(row, now) === 'ready' ? ready : check).push(row);
  return { check, ready };
}

/** The review order: everything to check first, then the ready ones, oldest first within each. */
export function reviewOrder(rows, now, { only = null } = {}) {
  const { check, ready } = splitQueue(rows, now);
  const byAge = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id - b.id;
  if (only === 'check') return [...check].sort(byAge);
  if (only === 'ready') return [...ready].sort(byAge);
  return [...check.sort(byAge), ...ready.sort(byAge)];
}

/** "5 en attente · la plus ancienne il y a 3 h · 2 à vérifier" — from the pending rows (all of them when total fits). */
export function queueSummary(rows, total, now) {
  const list = rows || [];
  const oldest = list.reduce((min, row) => (row.createdAt && (!min || row.createdAt < min) ? row.createdAt : min), null);
  return {
    total: Number(total) || 0,
    oldestAt: oldest,
    oldestMinutes: oldest ? Math.max(0, Math.round((now - new Date(oldest).getTime()) / 60000)) : null,
    toCheck: splitQueue(list, now).check.length,
    complete: list.length >= (Number(total) || 0),
  };
}

const REPLY_WORDS = new Set(['ok', 'oui', 'non', 'merci', 'bonjour', 'bonsoir', 'salut', 'svp', 'stp', 'd’accord', "d'accord", 'okay']);

/**
 * A name that reads like a message rather than a person or an agency — what
 * onboarding stored when it took a customer's sentence for their name
 * (2026-11-10: "Je contacte parce que j'ai vu…", "Ok"). A hint for the
 * moderator, never a verdict.
 */
export function nameLooksLikeSentence(name) {
  const text = String(name || '').trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 1 && REPLY_WORDS.has(words[0].replace(/[.!]+$/, ''))) return true;
  if (/[?!]/.test(text)) return true;
  if (words.length > 5) return true;
  return /^(je|j['’]|j ai|bonjour|bonsoir|salut|merci|svp|s['’]il|est-ce|c['’]est|voici|cette|ce bien)\b/.test(lower);
}

/** A message this short is a reply ("Ok", "Bien reçu"), not a description of a property. */
export const MIN_LISTING_TEXT = 25;

/**
 * The grey line under a row's title: the agent's own words about the
 * property. In order: the text the model read (the listing message itself),
 * else the first WhatsApp message long enough to describe something (a
 * "Bien reçu" a minute before the listing is not it — #814, 2026-11-10), else
 * any message, else the start of the description (web form). Null when nothing.
 */
export function agentTextLine(source, row) {
  const texts = (source?.messages || []).map((message) => String(message.body || '').trim()).filter(Boolean);
  const raw = String(source?.rawText || '').trim();
  const text = raw
    || texts.find((body) => body.length >= MIN_LISTING_TEXT)
    || texts[0]
    || row?.descriptionSnippet
    || null;
  if (!text) return null;
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 220) || null;
}
