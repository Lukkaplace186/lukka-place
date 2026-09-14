'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_COOKIE_OPTIONS, createSessionToken } from '@/lib/adminAuth';
import { activateAdminAccount } from '@/lib/adminUsers';
import { recordAudit } from '@/lib/adminAudit';

/**
 * Redeem an invitation or access-reset link: the person chooses their own
 * password, the link dies in the same UPDATE, and they are signed in.
 */
export async function activateAdminAction(formData) {
  const token = String(formData.get('token') || '');
  const result = await activateAdminAccount({
    token,
    password: formData.get('password'),
    confirm: formData.get('password_confirm'),
  });
  if (result.errorKey) {
    redirect(`/admin/activate?token=${encodeURIComponent(token)}&error=${encodeURIComponent(result.errorKey)}`);
  }

  const { user } = result;
  (await cookies()).set(
    ADMIN_SESSION_COOKIE,
    createSessionToken({ adminId: user.id, tokenVersion: user.token_version }),
    ADMIN_SESSION_COOKIE_OPTIONS,
  );
  await recordAudit(
    { id: user.id, shared: false, name: user.full_name, email: user.email },
    { action: 'team.activated', entityType: 'team', entityId: user.id },
  );
  redirect('/admin/dashboard');
}
