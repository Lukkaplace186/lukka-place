import 'server-only';
import { getPool } from './db';
import { actorLabel } from './adminAudit';

/**
 * Internal team notes on an agent, customer, listing or agency
 * (`console_admin_notes`). Never shown to the person the note is about, never
 * sent anywhere — the shared memory of "called, no answer", "promised a refund",
 * "photos are from another agency" that otherwise lives in someone's WhatsApp.
 */

export const NOTE_ENTITY_TYPES = ['agent', 'customer', 'listing', 'agency'];

export async function listNotes(entityType, entityId, limit = 50) {
  if (!NOTE_ENTITY_TYPES.includes(entityType)) return [];
  const { rows } = await getPool().query(
    `SELECT n.id, n.body, n.actor_label, n.created_at, u.full_name AS admin_name
     FROM console_admin_notes n
     LEFT JOIN console_admin_users u ON u.id = n.admin_user_id
     WHERE n.entity_type = $1 AND n.entity_id = $2
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $3`,
    [entityType, String(entityId), Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}

export async function addNote(session, entityType, entityId, body) {
  if (!NOTE_ENTITY_TYPES.includes(entityType)) throw new Error(`Unknown note entity '${entityType}'`);
  const text = String(body || '').trim().slice(0, 4000);
  if (!text) return null;
  const { rows } = await getPool().query(
    `INSERT INTO console_admin_notes (entity_type, entity_id, admin_user_id, actor_label, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [entityType, String(entityId), session.id, actorLabel(session), text],
  );
  return rows[0]?.id ?? null;
}
