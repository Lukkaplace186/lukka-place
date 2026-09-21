import 'server-only';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getPool } from './db';
import {
  MAX_PENDING_VERIFICATION_DOCS,
  MAX_VERIFICATION_DOC_BYTES,
  VERIFICATION_DOC_STATUSES,
  VERIFICATION_DOC_TYPES,
  VERIFICATION_LEVELS,
  levelRequirementMissing,
  sniffDocumentType,
} from './verificationLevels';

/**
 * Agent verification documents and levels. Schema:
 * migrations/20260917_agent_verification.sql (engine repo). Pure rules
 * (levels, requirements, file sniffing) are in lib/verificationLevels.js.
 *
 * STORAGE IS PRIVATE. Unlike avatars and listing photos (public buckets,
 * public URLs), these objects live in SUPABASE_VERIFICATION_BUCKET, created
 * private by scripts/setup-verification-bucket.js. Nothing here ever asks for
 * a public URL; the console reads a document only through
 * createDocumentSignedUrl, from an audited route.
 */

const BUCKET = process.env.SUPABASE_VERIFICATION_BUCKET || 'agent-verification';

let client = null;
function storage() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client.storage.from(BUCKET);
}

/** Console accounts have positive ids; the shared bootstrap session is 0 and records NULL, honestly. */
function reviewerId(adminId) {
  const id = Number(adminId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const DOC_COLUMNS = `id, agent_id, doc_type, original_name, mime_type, size_bytes, status, review_note,
  reviewed_at, reviewed_by, created_at`;

/** The agent's own view: level + every document they sent (newest first). Never the storage path. */
export async function getAgentVerification(agentId) {
  const pool = getPool();
  const [{ rows: agentRows }, { rows: documents }] = await Promise.all([
    pool.query('SELECT verification_level, verification_reviewed_at FROM agents WHERE id = $1', [agentId]),
    pool.query(
      `SELECT ${DOC_COLUMNS} FROM agent_verification_documents WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [agentId],
    ),
  ]);
  return {
    level: agentRows[0]?.verification_level || 'standard',
    reviewedAt: agentRows[0]?.verification_reviewed_at || null,
    documents,
  };
}

/**
 * @param {number} agentId
 * @param {{docType: string, file: File|null}} input
 * @returns {Promise<{ok: true, id: number}|{ok: false, code: string}>}
 */
export async function submitVerificationDocument(agentId, { docType, file }) {
  if (!VERIFICATION_DOC_TYPES.includes(docType)) return { ok: false, code: 'invalid_type' };
  if (!file || typeof file === 'string' || !file.size) return { ok: false, code: 'empty' };
  if (file.size > MAX_VERIFICATION_DOC_BYTES) return { ok: false, code: 'too_large' };

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniffDocumentType(buffer.subarray(0, 16));
  if (!kind) return { ok: false, code: 'bad_format' };

  const pool = getPool();
  const { rows: pendingRows } = await pool.query(
    `SELECT count(*)::int AS n FROM agent_verification_documents WHERE agent_id = $1 AND status = 'pending'`,
    [agentId],
  );
  if ((pendingRows[0]?.n ?? 0) >= MAX_PENDING_VERIFICATION_DOCS) return { ok: false, code: 'too_many_pending' };

  // Random, not content-hashed like avatars: the name must not let anyone who
  // holds a copy of a document confirm it is stored here.
  const storagePath = `agents/${agentId}/${docType}_${crypto.randomUUID()}.${kind.ext}`;
  const { error } = await storage().upload(storagePath, buffer, { contentType: kind.mime, upsert: false });
  if (error) {
    console.error(`[verification] upload failed for agent #${agentId}: ${error.message}`);
    return { ok: false, code: 'upload_failed' };
  }

  const originalName = typeof file.name === 'string' ? file.name.slice(0, 200) : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_verification_documents (agent_id, doc_type, storage_path, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [agentId, docType, storagePath, originalName, kind.mime, buffer.length],
    );
    return { ok: true, id: Number(rows[0].id) };
  } catch (err) {
    // Don't leave an ID card in the bucket with no row pointing at it.
    await storage().remove([storagePath]).catch(() => {});
    console.error(`[verification] insert failed for agent #${agentId}: ${err.message}`);
    return { ok: false, code: 'upload_failed' };
  }
}

/**
 * The console queue, one page at a time. Oldest first for `pending` (work
 * the longest wait first), newest first otherwise.
 */
export async function listVerificationDocuments({ status = 'pending', agentId = null, limit = 25, offset = 0 } = {}) {
  const where = [];
  const values = [];
  if (VERIFICATION_DOC_STATUSES.includes(status)) {
    values.push(status);
    where.push(`d.status = $${values.length}`);
  }
  if (Number.isFinite(Number(agentId)) && agentId !== null) {
    values.push(Number(agentId));
    where.push(`d.agent_id = $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = status === 'pending' ? 'd.created_at ASC, d.id ASC' : 'd.created_at DESC, d.id DESC';

  const pool = getPool();
  const [{ rows }, { rows: countRows }, { rows: summaryRows }] = await Promise.all([
    pool.query(
      `SELECT d.id, d.agent_id, d.doc_type, d.original_name, d.mime_type, d.size_bytes, d.status, d.review_note,
              d.reviewed_at, d.created_at, a.verification_level
       FROM agent_verification_documents d
       JOIN agents a ON a.id = d.agent_id
       ${whereSql}
       ORDER BY ${order}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
    pool.query(`SELECT count(*)::int AS total FROM agent_verification_documents d ${whereSql}`, values),
    pool.query(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending FROM agent_verification_documents`),
  ]);
  return { rows, total: countRows[0]?.total ?? 0, pending: summaryRows[0]?.pending ?? 0 };
}

/** Includes the storage path — for the audited document route only. */
export async function getVerificationDocument(id) {
  if (!Number.isFinite(id)) return null;
  const { rows } = await getPool().query(
    `SELECT ${DOC_COLUMNS}, storage_path FROM agent_verification_documents WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function createDocumentSignedUrl(storagePath, seconds = 300) {
  const { data, error } = await storage().createSignedUrl(storagePath, seconds);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'no signed URL returned');
  return data.signedUrl;
}

/**
 * Removes stored documents from the private bucket — for an agent account
 * being deleted (lib/adminAgentDeletion.js). An ID card must not outlive the
 * account it was uploaded for. Returns how many paths the bucket refused, so
 * the caller can log it; it never throws.
 */
export async function removeVerificationFiles(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return 0;
  try {
    const { error } = await storage().remove(list);
    return error ? list.length : 0;
  } catch {
    return list.length;
  }
}

/**
 * Approve or reject one document. A rejection carries the reason the agent
 * will read on their settings page.
 *
 * Rejecting a document the agent's CURRENT level relies on also lowers the
 * level to what the remaining approved documents still support, in the same
 * transaction — a badge must never outlive the evidence behind it.
 *
 * @returns {Promise<{document: object, level: {from: string, to: string}|null}|null>}
 */
export async function reviewVerificationDocument(id, { status, note = null, adminId = null }) {
  if (!['approved', 'rejected'].includes(status)) throw new Error(`invalid review status '${status}'`);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE agent_verification_documents
       SET status = $1, review_note = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4
       RETURNING ${DOC_COLUMNS}`,
      [status, note ? String(note).slice(0, 500) : null, reviewerId(adminId), id],
    );
    const document = rows[0];
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }

    let level = null;
    if (status === 'rejected') {
      const { rows: agentRows } = await client.query(
        'SELECT verification_level FROM agents WHERE id = $1 FOR UPDATE',
        [document.agent_id],
      );
      const current = agentRows[0]?.verification_level || 'standard';
      const { rows: docs } = await client.query(
        'SELECT doc_type, status FROM agent_verification_documents WHERE agent_id = $1',
        [document.agent_id],
      );
      const supported = highestSupportedLevel(current, docs);
      if (supported !== current) {
        await client.query(
          `UPDATE agents SET verification_level = $1, verification_reviewed_at = NOW(),
                  verification_reviewed_by = $2, updated_at = NOW() WHERE id = $3`,
          [supported, reviewerId(adminId), document.agent_id],
        );
        level = { from: current, to: supported };
      }
    }

    await client.query('COMMIT');
    return { document, level };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The highest level at or below `current` that the documents still support. */
export function highestSupportedLevel(current, documents) {
  const ladder = VERIFICATION_LEVELS.slice(0, VERIFICATION_LEVELS.indexOf(current) + 1).reverse();
  return ladder.find((level) => levelRequirementMissing(level, documents) === null) || 'standard';
}

/**
 * Set an agent's level. Raising it requires the approved documents the level
 * stands for (levelRequirementMissing); lowering it never does.
 *
 * @returns {Promise<{ok: true, from: string, to: string}|{ok: false, code: string}>}
 */
export async function setAgentVerificationLevel(agentId, level, { adminId = null } = {}) {
  if (!VERIFICATION_LEVELS.includes(level)) return { ok: false, code: 'unknown_level' };
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: agentRows } = await client.query(
      'SELECT verification_level FROM agents WHERE id = $1 FOR UPDATE',
      [agentId],
    );
    if (!agentRows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'not_found' };
    }
    const from = agentRows[0].verification_level || 'standard';
    const raising = VERIFICATION_LEVELS.indexOf(level) > VERIFICATION_LEVELS.indexOf(from);
    if (raising) {
      const { rows: docs } = await client.query(
        'SELECT doc_type, status FROM agent_verification_documents WHERE agent_id = $1',
        [agentId],
      );
      const missing = levelRequirementMissing(level, docs);
      if (missing) {
        await client.query('ROLLBACK');
        return { ok: false, code: missing };
      }
    }
    await client.query(
      `UPDATE agents SET verification_level = $1, verification_reviewed_at = NOW(),
              verification_reviewed_by = $2, updated_at = NOW() WHERE id = $3`,
      [level, reviewerId(adminId), agentId],
    );
    await client.query('COMMIT');
    return { ok: true, from, to: level };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
