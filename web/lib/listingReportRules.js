/**
 * "Signaler cette annonce" rules (2026-11-27), pure: shared by the form
 * (components/listings/ReportListingButton.js), the action and the tests.
 * The reasons are the CHECK list in migrations/20261127_listing_reports.sql;
 * change both together.
 */

export const REPORT_REASONS = Object.freeze(['scam', 'unavailable', 'wrong_price', 'wrong_info', 'duplicate', 'other']);

export const REPORT_NOTE_MAX = 500;

/** Reports one visitor may send in the rate window (lib/eventIngest.js rateLimited). */
export const REPORTS_PER_VISITOR = 5;

export const REPORT_STATUSES = Object.freeze(['open', 'resolved', 'dismissed']);

/**
 * The form's values, cleaned, or an i18n error key. "Autre" needs a few
 * words: a bare "other" tells the team nothing to check.
 */
export function readReport({ reason, note }) {
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (!REPORT_REASONS.includes(cleanReason)) return { error: 'listings.detail.report.errors.reason' };
  const cleanNote = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  if (cleanNote.length > REPORT_NOTE_MAX) return { error: 'listings.detail.report.errors.tooLong' };
  if (cleanReason === 'other' && cleanNote.length < 5) return { error: 'listings.detail.report.errors.otherNeedsNote' };
  return { reason: cleanReason, note: cleanNote || null };
}
