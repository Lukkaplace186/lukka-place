/**
 * Pure rules for the console's bulk soft delete (lib/adminSoftDelete.js):
 * shared by the Server Actions, the confirmation dialog and
 * tests/unit/admin-soft-delete.test.js.
 */

export const SOFT_DELETE_ENTITIES = ['agent', 'agency', 'listing'];

/** One delete never touches more than this many selected records (a page is ≤100). */
export const SOFT_DELETE_MAX = 100;

/** How long the toast offers "Annuler". */
export const UNDO_TOAST_MS = 10_000;

/**
 * How long the server still accepts that undo. Longer than the toast on
 * purpose: a click at 9.9 s over a Kinshasa link (≈330 ms to the VPS) must
 * not be refused. After this the delete stands.
 */
export const UNDO_GRACE_MS = 60_000;

/** Positive integer ids, de-duplicated, or null when the selection is unusable. */
export function cleanIds(ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (clean.length === 0 || clean.length > SOFT_DELETE_MAX) return null;
  return clean;
}

export function undoStillOpen(deletedAt, now = Date.now()) {
  const at = new Date(deletedAt).getTime();
  return Number.isFinite(at) && now - at <= UNDO_GRACE_MS;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBatchId = (value) => typeof value === 'string' && UUID_RE.test(value);
