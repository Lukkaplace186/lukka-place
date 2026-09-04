import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { getListingExportRows, toCsv } from '@/lib/dataExport';

/**
 * Admin-only CSV of the listing market data (see lib/dataExport.js for the
 * column contract).
 *
 * Sits under /admin/* so middleware.js already gates it, but re-checks the
 * session itself: this is the single endpoint that hands over the entire
 * dataset in one request, so it does not rely solely on the layer above —
 * the same defense-in-depth the moderation actions use. A path-matcher
 * change that accidentally exempted this route would otherwise publish the
 * whole database.
 *
 * `force-dynamic` matters here: without it this could be statically rendered
 * at build time and then serve a frozen snapshot of the market forever.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) {
    return new Response('Not authenticated', { status: 401 });
  }

  const rows = await getListingExportRows();
  const filename = `lukka-place-annonces-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A market snapshot must never be served from a cache — an
      // intermediary handing back yesterday's figures would be worse than
      // no export at all.
      'Cache-Control': 'no-store',
    },
  });
}
