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

export async function approveListingAction(listingId) {
  await setApprovalStatus(listingId, 1);
  notifyBestEffort(listingId, 'approved');
}

export async function rejectListingAction(listingId) {
  await setApprovalStatus(listingId, 2);
  notifyBestEffort(listingId, 'rejected');
}
