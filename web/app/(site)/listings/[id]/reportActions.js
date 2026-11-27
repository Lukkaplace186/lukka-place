'use server';

import { cookies, headers } from 'next/headers';
import { getListingById } from '@/lib/listings';
import { getCurrentCustomerId } from '@/lib/customers';
import { createListingReport, visitorHash } from '@/lib/listingReports';
import { readReport, REPORTS_PER_VISITOR } from '@/lib/listingReportRules';
import { rateLimited } from '@/lib/eventIngest';
import { clientIpFromHeaders } from '@/lib/clientIp';
import { VISITOR_COOKIE, cleanVisitorId } from '@/lib/trackIngest';

/**
 * "Signaler cette annonce" (2026-11-27, components/listings/ReportListingButton.js).
 * Anyone may report a PUBLIC listing (getListingById applies the public gate,
 * so a crafted id for a pending listing is refused like a missing one). The
 * visitor is the `lp_vid` cookie, else the address, stored only as a hash; a
 * signed-in customer's id is kept too. Nothing is sent to the agent: the team
 * checks first (/admin/signalements). Always answers, never throws.
 *
 * @returns {Promise<{ ok: true, duplicate?: boolean } | { ok: false, error: string }>}
 */
export async function reportListingAction(propertyId, formData) {
  const id = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'listings.detail.report.errors.failed' };

  const read = readReport({ reason: formData.get('reason'), note: formData.get('note') });
  if (read.error) return { ok: false, error: read.error };

  try {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    const visitor = cleanVisitorId(cookieStore.get(VISITOR_COOKIE)?.value) || clientIpFromHeaders(headerList) || null;
    if (rateLimited(`report:${visitor || 'unknown'}`, REPORTS_PER_VISITOR)) {
      return { ok: false, error: 'listings.detail.report.errors.tooMany' };
    }

    const listing = await getListingById(id);
    if (!listing) return { ok: false, error: 'listings.detail.report.errors.gone' };

    const customerId = await getCurrentCustomerId().catch(() => null);
    const result = await createListingReport({
      propertyId: id,
      reason: read.reason,
      note: read.note,
      customerId,
      visitor: visitorHash(visitor),
    });
    if (!result.ok) return { ok: false, error: 'listings.detail.report.errors.failed' };
    return result.duplicate ? { ok: true, duplicate: true } : { ok: true };
  } catch (err) {
    console.error('[listing-report] failed:', err?.message || err);
    return { ok: false, error: 'listings.detail.report.errors.failed' };
  }
}
