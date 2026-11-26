import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminSession';
import { homeFor } from '@/lib/adminRoles';

// Each person opens on their primary role's work queue (lib/adminRoles.js homeFor).
export default async function AdminIndexPage() {
  const session = await getAdminSession();
  redirect(session ? homeFor(session) : '/admin/dashboard');
}
