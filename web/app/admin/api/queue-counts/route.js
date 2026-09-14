import { getAdminSession } from '@/lib/adminSession';
import { getWorkQueueCounts } from '@/lib/adminWorkQueues';

export const dynamic = 'force-dynamic';

/** Live counts for the sidebar badges and "new items" notices. Any signed-in team member. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  const counts = await getWorkQueueCounts();
  return Response.json({ counts }, { headers: { 'Cache-Control': 'no-store' } });
}
