import 'server-only';
import { headers } from 'next/headers';
import { getPool } from './db';
import { keysetClause, pageCursors } from './adminPagination';

/**
 * The console's audit trail (`console_admin_audit_log`).
 *
 * Every mutating admin action records who did it, what, to which entity, and
 * from where. It answers the question the old console could not: "who approved
 * this listing / suspended this agent / changed this plan?"
 *
 * Recording never throws into the action that called it — an audit insert
 * failing must not turn a completed moderation decision into an error page —
 * but it is awaited and a failure is logged loudly, because a silently missing
 * audit row is exactly what an audit log exists to prevent.
 */

export function actorLabel(session) {
  if (!session) return 'unknown';
  if (session.shared) return 'shared-password';
  return `${session.name} <${session.email}>`;
}

async function requestContext() {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    return {
      ip: (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') || '').trim().slice(0, 64) || null,
      userAgent: (h.get('user-agent') || '').slice(0, 300) || null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * @param {{id: number|null, shared: boolean, name?: string, email?: string}} session
 * @param {{action: string, entityType?: string|null, entityId?: string|number|null, details?: object|null}} entry
 */
export async function recordAudit(session, { action, entityType = null, entityId = null, details = null }) {
  const { ip, userAgent } = await requestContext();
  try {
    await getPool().query(
      `INSERT INTO console_admin_audit_log
         (admin_user_id, actor_label, action, entity_type, entity_id, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        session?.id ?? null,
        actorLabel(session),
        String(action).slice(0, 80),
        entityType,
        entityId == null ? null : String(entityId),
        details == null ? null : JSON.stringify(details),
        ip,
        userAgent,
      ],
    );
  } catch (err) {
    console.error(`[audit] FAILED to record ${action} on ${entityType}:${entityId} by ${actorLabel(session)}: ${err.message}`);
  }
}

export const AUDIT_ENTITY_TYPES = ['listing', 'agent', 'agency', 'customer', 'conversation', 'lead', 'viewing', 'membership', 'package', 'cms', 'team', 'session'];

/**
 * One page of the audit log, newest first.
 * @param {{adminUserId?: number|'shared', action?: string, entityType?: string, entityId?: string,
 *          from?: string, to?: string, limit?: number, offset?: number}} [options]
 */
export async function listAuditLog({ adminUserId, action, entityType, entityId, from, to, limit = 50, offset = 0, cursor = null } = {}) {
  const params = [];
  const where = [];
  if (adminUserId === 'shared') where.push('l.admin_user_id IS NULL');
  else if (adminUserId != null && Number.isFinite(Number(adminUserId))) {
    params.push(Number(adminUserId));
    where.push(`l.admin_user_id = $${params.length}`);
  }
  if (action) {
    params.push(`${String(action).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`l.action LIKE $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    where.push(`l.entity_type = $${params.length}`);
  }
  if (entityId) {
    params.push(String(entityId));
    where.push(`l.entity_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`l.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`l.created_at < $${params.length}`);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const pageOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  // Append-only and unbounded: the pager's arrows seek by (created_at, id).
  const keyset = keysetClause(cursor, { ts: 'l.created_at', id: 'l.id', descending: true }, params.length + 1);
  const pageWhere = [...where, keyset.condition].filter(Boolean);
  const pageParams = [...params, ...keyset.values];
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM console_admin_audit_log l ${whereClause}`, params),
    pool.query(
      `SELECT l.id, l.admin_user_id, l.actor_label, l.action, l.entity_type, l.entity_id, l.details, l.ip, l.created_at,
              l.created_at::text AS cursor_ts, u.full_name AS admin_name
       FROM console_admin_audit_log l
       LEFT JOIN console_admin_users u ON u.id = l.admin_user_id
       ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
       ORDER BY ${keyset.orderBy}
       LIMIT $${pageParams.length + 1} OFFSET $${pageParams.length + 2}`,
      [...pageParams, pageLimit, cursor ? 0 : pageOffset],
    ),
  ]);
  const rows = keyset.reverse ? [...page.rows].reverse() : page.rows;
  return { total: count.rows[0]?.total ?? 0, rows, cursors: pageCursors(rows) };
}

/** The recent history of one entity, for its detail page timeline. */
export async function listEntityAudit(entityType, entityId, limit = 50) {
  const { rows } = await getPool().query(
    `SELECT l.id, l.actor_label, l.action, l.details, l.created_at, u.full_name AS admin_name
     FROM console_admin_audit_log l
     LEFT JOIN console_admin_users u ON u.id = l.admin_user_id
     WHERE l.entity_type = $1 AND l.entity_id = $2
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $3`,
    [entityType, String(entityId), Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}
