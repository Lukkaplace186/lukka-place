import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminSession';
import { ROLE_HOME } from '@/lib/adminRoles';

// Each role opens on its own work queue (lib/adminRoles.js ROLE_HOME).
export default async function AdminIndexPage() {
  const session = await getAdminSession();
  redirect(ROLE_HOME[session?.role] || '/admin/dashboard');
}
