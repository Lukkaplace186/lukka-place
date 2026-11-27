'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { setListingReportStatus } from '@/lib/listingReports';

/**
 * Marks a listing report handled ("Traité") or not acted on ("Ignoré"), or
 * reopens it. Changing the listing itself (suspend, correct, reject) stays on
 * its own console page, linked from the row; this only records the outcome.
 */
export async function setListingReportStatusAction(formData) {
  const session = await requireAdmin('listings.moderate');
  const id = Number.parseInt(formData.get('report_id'), 10);
  const status = String(formData.get('status') || '');
  const view = String(formData.get('view') || 'open');
  const back = `/admin/signalements${view === 'open' ? '' : `?statut=${encodeURIComponent(view)}`}`;
  if (!Number.isFinite(id) || !['resolved', 'dismissed', 'open'].includes(status)) redirect(back);

  const by = session.shared ? 'shared' : session.name || session.email || `admin:${session.id}`;
  let changed = false;
  try {
    changed = await setListingReportStatus(id, status, by);
  } catch (err) {
    console.warn(`[admin/signalements] report #${id} -> ${status} failed: ${err.message}`);
  }
  if (changed) {
    await recordAudit(session, { action: 'listing_report.status', entityType: 'listing_report', entityId: id, details: { status } });
  }
  revalidatePath('/admin/signalements');
  redirect(back);
}
