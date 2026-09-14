/**
 * Listing moderation vocabulary shared by the queue, its actions and its tests.
 * Pure data — the engine holds the agent-facing French wording for each code
 * (routes/admin.js MODERATION_REJECTION_REASONS), since that is where the
 * WhatsApp message is written and sent.
 */

export const REJECTION_REASON_CODES = [
  'MISSING_INFO', 'BAD_PHOTOS', 'WRONG_PRICE', 'DUPLICATE', 'SUSPECTED_FRAUD', 'NOT_REAL_ESTATE', 'OTHER',
];

export const REJECTION_REASON_LABEL_KEYS = Object.fromEntries(
  REJECTION_REASON_CODES.map((code) => [code, `admin.moderation.reason.${code}`]),
);

/**
 * Quality flags the queue computes in SQL (lib/moderationQueue.js). A flag is a
 * fact about the row to look at, never an automatic verdict.
 */
export const QUALITY_FLAGS = [
  'no_photos', 'few_photos', 'missing_commune', 'missing_price', 'missing_content', 'extraction_failure',
  'price_outlier', 'duplicate_photo', 'duplicate_listing', 'agent_unverified', 'no_agent',
];

export const QUALITY_FLAG_LABEL_KEYS = Object.fromEntries(
  QUALITY_FLAGS.map((flag) => [flag, `admin.moderation.flag.${flag}`]),
);

/** Flags that should stop a moderator and make them look twice. */
export const BLOCKING_FLAGS = new Set(['missing_price', 'missing_content', 'extraction_failure', 'duplicate_photo', 'duplicate_listing']);

export const MODERATION_QUEUE_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

/**
 * The same markers approveListingAction refuses to publish. One list, so the
 * queue's "extraction failure" flag and the approval guard can never disagree.
 */
export const EXTRACTION_FAILURE_MARKERS = [
  'ne contient',
  'uniquement une image',
  'sans information',
  'aucune information',
];
