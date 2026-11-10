import { NextResponse } from 'next/server';
import { getCurrentCustomerId } from '@/lib/customers';
import { openNotification } from '@/lib/pushNotifications';
import { parseId, safeCustomerPath } from '@/lib/pushRules';

export const dynamic = 'force-dynamic';

/** A relative Location: behind the proxy request.url names localhost:3002 (see admin/impersonation/exit). */
function goTo(path) {
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

/**
 * GET /compte/client/notifications/<id> — what a tapped customer alert
 * opens, from the phone or the inbox: marks it read (which also cancels its
 * late WhatsApp copy) and redirects to its page — the portal, a conversation
 * or a listing (safeCustomerPath); not this customer's alert, or none → the inbox.
 */
export async function GET(request, { params }) {
  const { id } = await params;
  const customerId = await getCurrentCustomerId();
  if (!customerId) return goTo('/compte/connexion?next=/compte/client/notifications');
  const notificationId = parseId(id);
  const opened = notificationId ? await openNotification('customer', customerId, notificationId) : null;
  return goTo(opened ? safeCustomerPath(opened.url) : '/compte/client/notifications');
}
