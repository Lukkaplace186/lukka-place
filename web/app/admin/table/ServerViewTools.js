import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { listSavedViews } from '@/lib/adminSavedViews';
import ViewTools from './ViewTools';

/**
 * Saved views + CSV export for one table page, resolved server-side so each
 * page only has to say where it is and what it exports.
 */
export default async function ServerViewTools({ path, params = {}, exportDataset = null }) {
  const session = await getAdminSession();
  const views = session?.id ? await listSavedViews(session.id, path).catch(() => []) : [];
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && key !== 'page' && key !== 'size') query.set(key, String(value));
  }
  return (
    <ViewTools
      path={path}
      query={query.toString()}
      views={views}
      canSave={Boolean(session?.id)}
      exportDataset={exportDataset && can(session?.role, 'data.export') ? exportDataset : null}
    />
  );
}
