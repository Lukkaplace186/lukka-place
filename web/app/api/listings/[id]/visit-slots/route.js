import { getPool } from '@/lib/db';
import { getBusySlots } from '@/lib/adminApi';
import { APPROVED_AGENT_LISTINGS_SQL } from '@/lib/visitSlotsServer';

/**
 * GET /api/listings/:id/visit-slots — the instants the listing's agent already
 * has a CONFIRMED visit, so the picker can grey out a clash
 * (lib/visitSlots.js). Instants only: no customer, no other listing. A listing
 * that is not public, or has no agent, answers `{ busy: [] }` — the picker then
 * offers every slot, which is the same as before this existed.
 *
 * Fails open: the engine being unreachable is an empty list, never an error the
 * visitor sees, because a picker that refuses to open costs the request.
 */
export async function GET(_request, { params }) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ busy: [] }, { status: 400 });

  try {
    const { rows } = await getPool().query(APPROVED_AGENT_LISTINGS_SQL, [id]);
    const agentId = rows[0]?.agent_id ?? null;
    if (!agentId) return Response.json({ busy: [] }, { headers: { 'Cache-Control': 'private, max-age=60' } });
    const busy = await getBusySlots({ agentId, propertyIds: rows.map((r) => Number(r.id)) });
    return Response.json({ busy }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    console.error(`[visit-slots] listing #${id}: ${err.message}`);
    return Response.json({ busy: [] });
  }
}
