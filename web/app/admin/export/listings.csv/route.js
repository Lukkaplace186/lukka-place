import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { recordAudit } from '@/lib/adminAudit';
import { getListingExportRows, toCsv } from '@/lib/dataExport';

/**
 * Admin-only CSV of the listing market data (see lib/dataExport.js for the
 * column contract). This is the single endpoint that hands over the entire
 * dataset in one request, so it checks the role itself and audits every
 * download rather than relying on the layers above.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAdminSession();
  if (!session) return new Response('Not authenticated', { status: 401 });
  if (!can(session.role, 'data.export')) return new Response('Forbidden', { status: 403 });

  const rows = await getListingExportRows();
  await recordAudit(session, { action: 'export.listings_csv', entityType: 'listing', details: { rows: rows.length } });
  const filename = `lukka-place-annonces-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A market snapshot must never be served from a cache.
      'Cache-Control': 'no-store',
    },
  });
}
