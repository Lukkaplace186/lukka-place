import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminSession';
import { getSalesRepIdForAdmin } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/** A stable link for a rep's own dashboard: their rep page, or the team page (which explains when no rep is linked). */
export default async function AdminSalesMePage() {
  const session = await getAdminSession();
  const repId = session?.id && !session.shared ? await getSalesRepIdForAdmin(session.id).catch(() => null) : null;
  redirect(repId ? `/admin/sales/${repId}` : '/admin/sales');
}
