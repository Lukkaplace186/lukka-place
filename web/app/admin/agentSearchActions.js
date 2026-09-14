'use server';

import { getAdminSession } from '@/lib/adminSession';
import { searchAgentsForAdmin } from '@/lib/agents';

/**
 * The agent picker's type-ahead. A Server Action is a public POST endpoint, so
 * the session is checked here too — the middleware gates pages, not actions
 * invoked from a page that is already open. Read-only: any signed-in role.
 */
export async function searchAgentsAction({ q = '', commune = null, routableOnly = false, activeOnly = false, excludeId = null } = {}) {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: 'Not authenticated', agents: [] };
  try {
    const agents = await searchAgentsForAdmin({
      q: String(q || '').slice(0, 80),
      commune: commune || null,
      routableOnly: Boolean(routableOnly),
      activeOnly: Boolean(activeOnly),
      excludeId,
    });
    return { ok: true, agents };
  } catch (err) {
    return { ok: false, error: err.message, agents: [] };
  }
}
