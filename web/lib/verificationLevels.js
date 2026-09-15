/**
 * Agent verification tiers — pure data, safe in client and server code.
 * Schema and the reasoning behind a level + timestamp rather than a boolean:
 * migrations/20260917_agent_verification.sql (engine repo).
 *
 *   standard        nobody has reviewed documents. The default, and what every
 *                   existing agent is — no backfill.
 *   verified        a team member reviewed an identity document (ID card or
 *                   passport) and approved it.
 *   agency_partner  verified, AND the agency's RCCM was reviewed and approved.
 *
 * Distinct from `agents.phone_verified_at` ("holds this number"). The green
 * public badge means the second, stronger claim.
 */

export const VERIFICATION_LEVELS = ['standard', 'verified', 'agency_partner'];

export const VERIFIED_LEVELS = ['verified', 'agency_partner'];

export const VERIFICATION_DOC_TYPES = ['id_card', 'passport', 'rccm', 'other'];

export const IDENTITY_DOC_TYPES = ['id_card', 'passport'];

export const VERIFICATION_DOC_STATUSES = ['pending', 'approved', 'rejected'];

/** The derived `is_verified` — never stored. */
export function isVerifiedLevel(level) {
  return VERIFIED_LEVELS.includes(level);
}

export const LEVEL_LABEL_KEYS = {
  standard: 'common.verification.standard',
  verified: 'common.verification.verified',
  agency_partner: 'common.verification.agencyPartner',
};

export const DOC_TYPE_LABEL_KEYS = {
  id_card: 'common.verification.docIdCard',
  passport: 'common.verification.docPassport',
  rccm: 'common.verification.docRccm',
  other: 'common.verification.docOther',
};

export const DOC_STATUS_LABEL_KEYS = {
  pending: 'common.verification.statusPending',
  approved: 'common.verification.statusApproved',
  rejected: 'common.verification.statusRejected',
};

/**
 * What a level requires, checked against the agent's documents at the moment
 * an admin grants it. Unlike listing verification (whose preconditions are
 * reported, never enforced — a photo count cannot prove a property exists),
 * this badge's whole meaning IS "the documents were reviewed", so granting it
 * with no approved document would be the fabrication.
 *
 * Lowering a level (revoking) has no precondition.
 *
 * @param {string} level
 * @param {Array<{doc_type: string, status: string}>} documents
 * @returns {string|null} a missing-requirement code, or null when satisfied
 */
export function levelRequirementMissing(level, documents = []) {
  if (!VERIFICATION_LEVELS.includes(level)) return 'unknown_level';
  if (level === 'standard') return null;
  const approved = new Set(documents.filter((d) => d.status === 'approved').map((d) => d.doc_type));
  if (!IDENTITY_DOC_TYPES.some((type) => approved.has(type))) return 'identity_required';
  if (level === 'agency_partner' && !approved.has('rccm')) return 'rccm_required';
  return null;
}

/**
 * Accepted upload formats by magic bytes — the browser's `file.type` is the
 * client's claim and is not trusted. PDF because an RCCM is usually a scan.
 *
 * @param {Uint8Array} bytes the first bytes of the file
 * @returns {{mime: string, ext: string}|null}
 */
export function sniffDocumentType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { mime: 'image/webp', ext: 'webp' };
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  return null;
}

export const MAX_VERIFICATION_DOC_BYTES = 10 * 1024 * 1024;

/** An agent may have at most this many documents waiting for review at once. */
export const MAX_PENDING_VERIFICATION_DOCS = 5;
