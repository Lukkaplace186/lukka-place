import { getAdminSession } from '@/lib/adminSession';
import { adminGlobalSearch } from '@/lib/adminSearch';
import { getSalesScope } from '@/lib/salesScope';

export const dynamic = 'force-dynamic';

/** Global console search — results limited to what the signed-in role may open. */
export async function GET(request) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  const q = new URL(request.url).searchParams.get('q') || '';
  const scope = await getSalesScope();
  const groups = await adminGlobalSearch(q, session.role, { repId: scope ? scope.repId : null }).catch((err) => {
    console.error(`[admin/search] failed: ${err.message}`);
    return [];
  });
  return Response.json({ groups }, { headers: { 'Cache-Control': 'no-store' } });
}
