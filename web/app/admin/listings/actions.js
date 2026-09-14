'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { notifyListingModeration } from '@/lib/adminApi';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { EXTRACTION_FAILURE_MARKERS, REJECTION_REASON_CODES } from '@/lib/moderation';

/**
 * Listing moderation writes — directly to Supabase Postgres, separate from
 * ../actions.js (which proxies to the engine's SQLite API).
 *
 * Every decision now records WHO decided, WHEN, and — for a rejection — WHY
 * (`moderated_by`, `moderated_at`, `moderation_reason_code`, `moderation_note`),
 * writes an audit row, and passes the reason to the engine so the agent's
 * WhatsApp message says what to fix instead of "needs adjustments".
 */

const BULK_LIMIT = 100;

function revalidateModeration(ids = []) {
  revalidatePath('/admin/listings');
  for (const id of ids.slice(0, 20)) revalidatePath(`/admin/listings/${id}`);
  revalidatePath('/listings');
  revalidatePath('/admin/dashboard');
}

/**
 * WhatsApp notification is a courtesy on top of the real decision — a failed
 * send must never turn a completed approve/reject into an error. Not awaited:
 * this runs in a long-lived PM2 process, so the promise completes after the
 * action returns, and the try/catch means it can never reject unhandled.
 */
async function notifyBestEffort(listingId, status, reason) {
  try {
    await notifyListingModeration(listingId, status, reason);
  } catch (err) {
    console.error(`[admin/listings] moderation notify for #${listingId} (${status}) failed: ${err.message}`);
  }
}

/**
 * Why a listing may not be published, or null. Approval is the last gate
 * before a listing is public, so these block rather than warn — real examples
 * of each reached the site before this check existed (#280's description was
 * the extractor's own failure message; #239 was priced 0.00).
 */
async function publishProblem(pool, listingId) {
  const { rows } = await pool.query(
    `SELECT p.price, pc.title, pc.description
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.id = $1`,
    [listingId],
  );
  const listing = rows[0];
  if (!listing) return `Annonce #${listingId} introuvable.`;
  if (!listing.title || !listing.description) {
    return `Annonce #${listingId} : contenu manquant (titre ou description). À rejeter plutôt qu'à publier.`;
  }
  if (listing.price == null || Number(listing.price) <= 0) {
    return `Annonce #${listingId} : le prix est absent ou nul. Corrigez-le avant de publier.`;
  }
  const description = String(listing.description).toLowerCase();
  if (EXTRACTION_FAILURE_MARKERS.some((marker) => description.includes(marker))) {
    return `Annonce #${listingId} : la description est un message d'erreur d'extraction, pas une vraie description.`;
  }
  return null;
}

async function writeDecision(pool, session, listingId, approveStatus, { reasonCode = null, note = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE properties
        SET approve_status = $1, moderation_reason_code = $2, moderation_note = $3,
            moderated_at = NOW(), moderated_by = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING id`,
    [approveStatus, approveStatus === 2 ? reasonCode : null, approveStatus === 2 ? note : null, session.id, listingId],
  );
  return rows.length > 0;
}

function cleanReason(reasonCode, note) {
  const code = REJECTION_REASON_CODES.includes(reasonCode) ? reasonCode : null;
  const text = String(note || '').trim().slice(0, 500) || null;
  return { reasonCode: code, note: text };
}

/** Form-action form (throws on failure) — used by the listing detail page. */
export async function approveListingAction(listingId) {
  const session = await requireAdmin('listings.moderate');
  const pool = getPool();
  const problem = await publishProblem(pool, listingId);
  if (problem) throw new Error(problem);
  if (!(await writeDecision(pool, session, listingId, 1))) throw new Error(`Annonce #${listingId} introuvable.`);
  await recordAudit(session, { action: 'listing.approve', entityType: 'listing', entityId: listingId });
  revalidateModeration([listingId]);
  notifyBestEffort(listingId, 'approved');
}

/** Form-action form, without a reason. Prefer moderateListingsAction, which records one. */
export async function rejectListingAction(listingId) {
  const session = await requireAdmin('listings.moderate');
  if (!(await writeDecision(getPool(), session, listingId, 2))) throw new Error(`Annonce #${listingId} introuvable.`);
  await recordAudit(session, { action: 'listing.reject', entityType: 'listing', entityId: listingId });
  revalidateModeration([listingId]);
  notifyBestEffort(listingId, 'rejected');
}

/**
 * Approve or reject one or many listings from the queue.
 *
 * Approval runs the publishability check per listing and SKIPS a listing that
 * fails it, reporting why, rather than failing the whole batch — one listing
 * with a missing price must not block the other 49 a moderator selected.
 * Rejection requires a reason code from the fixed list.
 *
 * @param {{ids: number[], decision: 'approve'|'reject', reasonCode?: string, note?: string}} input
 * @returns {Promise<{ok: boolean, error?: string, approved: number[], rejected: number[], skipped: {id: number, reason: string}[]}>}
 */
export async function moderateListingsAction({ ids, decision, reasonCode, note }) {
  try {
    const session = await requireAdmin('listings.moderate');
    const clean = [...new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (clean.length === 0) return { ok: false, error: 'Aucune annonce sélectionnée.', approved: [], rejected: [], skipped: [] };
    if (clean.length > BULK_LIMIT) return { ok: false, error: `Au maximum ${BULK_LIMIT} annonces à la fois.`, approved: [], rejected: [], skipped: [] };
    if (!['approve', 'reject'].includes(decision)) return { ok: false, error: 'Décision inconnue.', approved: [], rejected: [], skipped: [] };

    const reason = cleanReason(reasonCode, note);
    if (decision === 'reject' && !reason.reasonCode) {
      return { ok: false, error: 'Choisissez un motif de rejet.', approved: [], rejected: [], skipped: [] };
    }

    const pool = getPool();
    const approved = [];
    const rejected = [];
    const skipped = [];

    for (const id of clean) {
      if (decision === 'approve') {
        const problem = await publishProblem(pool, id);
        if (problem) {
          skipped.push({ id, reason: problem });
          continue;
        }
        if (await writeDecision(pool, session, id, 1)) approved.push(id);
        else skipped.push({ id, reason: `Annonce #${id} introuvable.` });
      } else if (await writeDecision(pool, session, id, 2, reason)) {
        rejected.push(id);
      } else {
        skipped.push({ id, reason: `Annonce #${id} introuvable.` });
      }
    }

    for (const id of approved) {
      await recordAudit(session, { action: 'listing.approve', entityType: 'listing', entityId: id, details: { bulk: clean.length > 1 } });
      notifyBestEffort(id, 'approved');
    }
    for (const id of rejected) {
      await recordAudit(session, {
        action: 'listing.reject',
        entityType: 'listing',
        entityId: id,
        details: { bulk: clean.length > 1, reasonCode: reason.reasonCode, note: reason.note },
      });
      notifyBestEffort(id, 'rejected', reason);
    }

    revalidateModeration([...approved, ...rejected]);
    return { ok: true, approved, rejected, skipped };
  } catch (err) {
    return { ok: false, error: err.message, approved: [], rejected: [], skipped: [] };
  }
}

/**
 * The preconditions behind "Vérifié par Lukka Place". REPORTED, NOT ENFORCED:
 * verification is a claim a human makes about a real property, so the console
 * shows what the data can and cannot support, then lets them decide.
 */
export async function getVerificationPreconditions(listingId) {
  await requireAdmin('listings.view');
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
 * Stamp a listing as verified. `verified_by` is now the console account that
 * made the claim — it stayed NULL for as long as the console had only a shared
 * password. Under that shared password it is still NULL, honestly.
 */
export async function verifyListingAction(listingId) {
  const session = await requireAdmin('listings.moderate');
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties
        SET verified_at = NOW(), verified_by = $2, updated_at = NOW()
      WHERE id = $1 AND approve_status = 1`,
    [listingId, session.id],
  );
  if (rowCount === 0) {
    throw new Error(
      `Annonce #${listingId} : introuvable, ou pas encore approuvée. Approuvez-la avant de la vérifier.`,
    );
  }
  await recordAudit(session, { action: 'listing.verify', entityType: 'listing', entityId: listingId });
  revalidatePath('/admin/listings');
  revalidatePath(`/admin/listings/${listingId}`);
}

/** Withdraw verification. The audit log keeps who withdrew it and when. */
export async function unverifyListingAction(listingId) {
  const session = await requireAdmin('listings.moderate');
  const pool = getPool();
  await pool.query(
    'UPDATE properties SET verified_at = NULL, verified_by = NULL, updated_at = NOW() WHERE id = $1',
    [listingId],
  );
  await recordAudit(session, { action: 'listing.unverify', entityType: 'listing', entityId: listingId });
  revalidatePath('/admin/listings');
  revalidatePath(`/admin/listings/${listingId}`);
}
