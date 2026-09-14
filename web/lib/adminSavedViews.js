import 'server-only';
import { getPool } from './db';

/**
 * Named filter sets per admin, per page (`console_admin_saved_views`): "Pending
 * in Gombe with no photos", "Escalated this week". Stored as the page's query
 * string, so applying one is just a navigation.
 */

const MAX_VIEWS_PER_PAGE = 20;

export async function listSavedViews(adminUserId, path) {
  if (!adminUserId) return [];
  const { rows } = await getPool().query(
    'SELECT id, name, query FROM console_admin_saved_views WHERE admin_user_id = $1 AND path = $2 ORDER BY LOWER(name)',
    [adminUserId, path],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function saveView(adminUserId, path, name, query) {
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanQuery = String(query || '').replace(/^\?/, '').slice(0, 1000);
  if (!cleanName) return { errorKey: 'admin.views.nameRequired' };
  if (!/^\/admin\/[a-z-]+$/.test(path)) return { errorKey: 'admin.views.invalidPage' };
  const { rows } = await getPool().query(
    'SELECT COUNT(*)::int AS n FROM console_admin_saved_views WHERE admin_user_id = $1 AND path = $2',
    [adminUserId, path],
  );
  if ((rows[0]?.n ?? 0) >= MAX_VIEWS_PER_PAGE) return { errorKey: 'admin.views.tooMany' };
  await getPool().query(
    `INSERT INTO console_admin_saved_views (admin_user_id, path, name, query)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (admin_user_id, path, name) DO UPDATE SET query = EXCLUDED.query`,
    [adminUserId, path, cleanName, cleanQuery],
  );
  return { ok: true };
}

export async function deleteView(adminUserId, id) {
  const { rowCount } = await getPool().query(
    'DELETE FROM console_admin_saved_views WHERE id = $1 AND admin_user_id = $2',
    [id, adminUserId],
  );
  return rowCount > 0;
}
