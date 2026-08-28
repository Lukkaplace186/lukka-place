import { getPool } from '@/lib/db';

/**
 * Public, write-only event logger for the /admin/dashboard analytics
 * (web/lib/analytics.js). No auth — same trust level as any client-side
 * beacon — and no read capability exposed here at all. Two event types only,
 * matching the two tables this exists to feed; anything else is a 400, not
 * silently accepted junk.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, path, commune, listingId } = body || {};
  const pool = getPool();

  try {
    if (type === 'page_view') {
      if (!path) return Response.json({ success: false, error: 'path is required' }, { status: 400 });
      await pool.query('INSERT INTO page_views (path, commune) VALUES ($1, $2)', [path, commune || null]);
    } else if (type === 'whatsapp_click') {
      await pool.query('INSERT INTO whatsapp_clicks (listing_id, commune) VALUES ($1, $2)', [
        listingId || null,
        commune || null,
      ]);
    } else {
      return Response.json({ success: false, error: "type must be 'page_view' or 'whatsapp_click'" }, { status: 400 });
    }
  } catch (err) {
    console.error(`[api/track] insert failed: ${err.message}`);
    return Response.json({ success: false }, { status: 500 });
  }

  return Response.json({ success: true });
}
