'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { notifyListingModeration } from '@/lib/adminApi';

/**
 * Separate from ../actions.js on purpose: every action there proxies through
 * lib/adminApi.js to the engine's SQLite-backed /admin/* API. These write
 * directly to Supabase Postgres (the real `properties` table) via
 * lib/db.js's getPool(), a different data path — keeping them apart keeps
 * that distinction visible instead of burying a Postgres write in a file
 * whose docblock says "wraps lib/adminApi.js".
 *
 * assertAdminSession() is defense-in-depth: middleware.js already gates
 * /admin/*, but this is the first admin action anywhere that mutates
 * production listing data directly, so it re-checks the session token
 * itself rather than relying solely on the middleware layer above it.
 */
async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

async function setApprovalStatus(listingId, approveStatus) {
  await assertAdminSession();
  const pool = getPool();
  await pool.query('UPDATE properties SET approve_status = $1, updated_at = NOW() WHERE id = $2', [
    approveStatus,
    listingId,
  ]);
  revalidatePath('/admin/listings');
}

/**
 * WhatsApp notification is a courtesy on top of the real moderation
 * decision, not part of it — a failed/timed-out send (no matching
 * submitter, Chakra down, etc.) must never surface as a failure of the
 * approve/reject action itself, since the Postgres write above already
 * succeeded and is the actual source of truth.
 *
 * Deliberately not awaited by its callers below: this process runs as a
 * long-lived PM2 fork (see web/CLAUDE.md's Deployment section), not a
 * serverless/edge function, so the event loop keeps this promise running
 * to completion after the Server Action returns and the page revalidates —
 * unlike on a platform that tears down the request's execution context the
 * moment the response is sent, where an un-awaited fetch could be killed
 * mid-flight. The try/catch below still guarantees this promise itself
 * never rejects, so there's no unhandled-rejection risk either.
 */
async function notifyBestEffort(listingId, status) {
  try {
    await notifyListingModeration(listingId, status);
  } catch (err) {
    console.error(`[admin/listings] moderation notify for #${listingId} (${status}) failed: ${err.message}`);
  }
}

/**
 * Placeholder content that reached the public site because a human clicked
 * Approuver without noticing what they were approving.
 *
 * Two real examples, both live and both found in the pre-launch QA sweep:
 *   #280 — description read "Le message contient uniquement une image de
 *          carte sans informations immobilières", the AI extractor's own
 *          failure message, published as the listing's description.
 *   #239 — priced 0.00, rendering as "0 $ / mois" on the homepage.
 *
 * Approval is the last gate before a listing is public, so the check belongs
 * here. It blocks rather than warns: an approval is one click and easily
 * done on autopilot, and the cost of a bad listing going live is much higher
 * than the cost of being asked to fix it first. Rejection stays unguarded —
 * a broken listing should always be rejectable.
 */
const EXTRACTION_FAILURE_MARKERS = [
  'ne contient',
  'uniquement une image',
  'sans information',
  'aucune information',
];

async function assertPublishable(listingId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.price, pc.title, pc.description
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.id = $1`,
    [listingId],
  );
  const listing = rows[0];
  if (!listing) throw new Error(`Annonce #${listingId} introuvable.`);

  if (!listing.title || !listing.description) {
    throw new Error(
      `Annonce #${listingId} : contenu manquant (titre ou description). À rejeter plutôt qu'à publier.`,
    );
  }
  if (listing.price == null || Number(listing.price) <= 0) {
    throw new Error(`Annonce #${listingId} : le prix est absent ou nul. Corrigez-le avant de publier.`);
  }

  const description = String(listing.description).toLowerCase();
  if (EXTRACTION_FAILURE_MARKERS.some((marker) => description.includes(marker))) {
    throw new Error(
      `Annonce #${listingId} : la description est un message d'erreur d'extraction, pas une vraie description.`,
    );
  }
}

export async function approveListingAction(listingId) {
  await assertAdminSession();
  await assertPublishable(listingId);
  await setApprovalStatus(listingId, 1);
  notifyBestEffort(listingId, 'approved');
}

export async function rejectListingAction(listingId) {
  await setApprovalStatus(listingId, 2);
  notifyBestEffort(listingId, 'rejected');
}

/**
 * The preconditions behind "Vérifié par Lukka Place".
 *
 * REPORTED, NOT ENFORCED — and that is the point. Verification is a claim a
 * human makes about a real property, so the console shows whoever is about to
 * make it what the data can and cannot support, then lets them decide. An
 * automatic rule ("≥1 photo AND a verified agent ⇒ verified") would derive
 * the badge from facts that do not actually establish it, which is precisely
 * the fabrication the no-invented-data rule forbids everywhere else here.
 *
 * @returns {Promise<{photos: number, agentVerified: boolean, communeTagged: boolean,
 *                    approved: boolean, verifiedAt: string|null, verifiedBy: number|null}>}
 */
export async function getVerificationPreconditions(listingId) {
  await assertAdminSession();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.verified_at,
            p.verified_by,
            (p.approve_status = 1)                       AS approved,
            (a.phone_verified_at IS NOT NULL)            AS agent_verified,
            (SELECT COUNT(*)::int FROM property_slider_images si
              WHERE si.property_id = p.id)               AS photo_count,
            EXISTS (SELECT 1 FROM property_amenities pa
                     WHERE pa.property_id = p.id
                       AND pa.amenity_id BETWEEN 21 AND 44) AS commune_tagged
       FROM properties p
       LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1`,
    [listingId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Annonce #${listingId} introuvable.`);

  return {
    photos: row.photo_count,
    agentVerified: Boolean(row.agent_verified),
    communeTagged: Boolean(row.commune_tagged),
    approved: Boolean(row.approved),
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
  };
}

/**
 * Stamp a listing as verified.
 *
 * `verified_by` records WHO, which is the first question asked the day a
 * verified listing turns out not to be real. This console has one shared team
 * password rather than per-admin accounts (lib/adminAuth.js — deliberately
 * the smallest real thing that answers "is this a Lukka Place team member"),
 * so there is no admin id to record and the column is left NULL rather than
 * filled with a fake one. When per-admin accounts exist, this is where the id
 * goes; until then NULL honestly means "a team member, we cannot say which".
 *
 * An unapproved listing cannot be verified: claiming we confirmed a property
 * that has not even passed moderation puts the two axes in an order that
 * makes no sense.
 */
export async function verifyListingAction(listingId) {
  await assertAdminSession();
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties
        SET verified_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND approve_status = 1`,
    [listingId],
  );
  if (rowCount === 0) {
    throw new Error(
      `Annonce #${listingId} : introuvable, ou pas encore approuvée. Approuvez-la avant de la vérifier.`,
    );
  }
  revalidatePath('/admin/listings');
  revalidatePath(`/admin/listings/${listingId}`);
}

/**
 * Withdraw verification.
 *
 * Clears the timestamp outright rather than keeping a history: this column
 * answers "is this listing verified, and since when", and a withdrawn
 * verification is simply not one. The audit trail that matters lives in the
 * market export, which carries verified_at per row at the time it was taken.
 */
export async function unverifyListingAction(listingId) {
  await assertAdminSession();
  const pool = getPool();
  await pool.query(
    'UPDATE properties SET verified_at = NULL, verified_by = NULL, updated_at = NOW() WHERE id = $1',
    [listingId],
  );
  revalidatePath('/admin/listings');
  revalidatePath(`/admin/listings/${listingId}`);
}
