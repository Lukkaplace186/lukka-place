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
  'same_agent_resend',
  'no_photos', 'few_photos', 'missing_commune', 'missing_price', 'missing_content', 'extraction_failure',
  'price_outlier', 'duplicate_photo', 'duplicate_listing', 'agent_unverified', 'no_agent',
  'availability_unanswered',
];

/**
 * The flags that point at other listings, each opening the comparison
 * (/admin/listings/compare). Owner decision 2026-11-10: the same agent
 * sending the same property twice is not allowed (same_agent_resend, red);
 * the same property with another agent is fine (duplicate_photo, a note);
 * a matching title and price alone is mostly look-alike units (a note).
 */
export const DUPLICATE_FLAGS = ['same_agent_resend', 'duplicate_photo', 'duplicate_listing'];

/** Facts worth a look, never a reason to hold a listing back. Drawn grey. */
export const INFO_FLAGS = new Set(['duplicate_photo', 'duplicate_listing']);

export const QUALITY_FLAG_LABEL_KEYS = Object.fromEntries(
  QUALITY_FLAGS.map((flag) => [flag, `admin.moderation.flag.${flag}`]),
);

/** Flags that should stop a moderator and make them look twice. */
export const BLOCKING_FLAGS = new Set(['missing_price', 'missing_content', 'extraction_failure', 'same_agent_resend', 'no_photos', 'few_photos']);

/**
 * The standard (owner, 2026-11-10): a listing goes live with at least 3
 * photos. A video counts as one, as on WhatsApp (services/listingMedia.js).
 * The queue flags fewer (no_photos / few_photos) and approval refuses them.
 */
export const MIN_LISTING_MEDIA = 3;

/** Why a listing cannot be approved for its media, or null when it has enough. */
export function mediaShortfall(listingId, photoCount, videoCount = 0) {
  const photos = Number(photoCount) || 0;
  const videos = Number(videoCount) || 0;
  if (photos + videos >= MIN_LISTING_MEDIA) return null;
  const have = videos ? `${photos} photo(s) et ${videos} vidéo(s)` : `${photos} photo(s)`;
  return `Annonce #${listingId} : ${have}. Il en faut au moins ${MIN_LISTING_MEDIA} pour publier — demandez d'autres photos à l'agent.`;
}

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
