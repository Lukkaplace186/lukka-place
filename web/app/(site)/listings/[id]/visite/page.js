import { notFound } from 'next/navigation';
import AppVisitBooking from '@/components/app/AppVisitBooking';
import { getListingById } from '@/lib/listings';
import { getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('appShell.visit.title'), robots: { index: false } };
}

const SENT = new Set(['1', 'team']);
const ERRORS = new Set(['phone', 'time', 'closed', '1']);

/**
 * /listings/<id>/visite — the app's full-screen visit booking
 * (components/app/AppVisitBooking.js). Reachable from any browser, linked
 * from the app's listing bar. `getListingById` applies the public listing
 * gate, so a pending or hidden listing is a 404 here too (the segment's
 * layout already checked it exists). The visit action answers back here with
 * `visit_sent` or `visit_error`; anything else in those params is ignored.
 */
export default async function VisitBookingPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const listing = await getListingById(id);
  if (!listing) notFound();
  const sent = SENT.has(String(query?.visit_sent)) ? String(query.visit_sent) : null;
  const error = ERRORS.has(String(query?.visit_error)) ? String(query.visit_error) : null;
  return <AppVisitBooking listing={listing} sent={sent} error={error} />;
}
