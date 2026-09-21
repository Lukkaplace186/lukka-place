import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { recordAudit } from '@/lib/adminAudit';
import { EXCEL_CSV_OPTIONS, getListingExportRows, toCsv, withEngagement } from '@/lib/dataExport';
import { getPerListingStats } from '@/lib/analytics';
import { countViewingRequestsByProperty } from '@/lib/adminApi';

/**
 * Admin-only CSV of the listing market data (see lib/dataExport.js for the
 * column contract). This is the single endpoint that hands over the entire
 * dataset in one request, so it checks the role itself and audits every
 * download rather than relying on the layers above.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await getAdminSession();
  if (!session) return new Response('Not authenticated', { status: 401 });
  if (!can(session.role, 'data.export')) return new Response('Forbidden', { status: 403 });

  const excel = new URL(request.url).searchParams.get('format') === 'excel';
  const base = await getListingExportRows();
  // Engagement columns (lib/dataExport.js withEngagement). An engine that does
  // not answer leaves visit_requests_total empty rather than failing the file.
  const [stats, visits] = await Promise.all([
    getPerListingStats(base.map((row) => Number(row.property_id))),
    countViewingRequestsByProperty().catch((err) => {
      console.error(`[export] visit request counts unavailable: ${err.message}`);
      return null;
    }),
  ]);
  const rows = withEngagement(base, stats, visits);
  await recordAudit(session, {
    action: 'export.listings_csv',
    entityType: 'listing',
    details: { rows: rows.length, format: excel ? 'excel' : 'csv', visitCounts: visits ? 'engine' : 'unavailable' },
  });
  const filename = `lukka-place-annonces-${new Date().toISOString().slice(0, 10)}${excel ? '-excel' : ''}.csv`;

  return new Response(toCsv(rows, undefined, excel ? EXCEL_CSV_OPTIONS : undefined), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A market snapshot must never be served from a cache.
      'Cache-Control': 'no-store',
    },
  });
}
