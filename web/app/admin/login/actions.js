'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPassword, createSessionToken, ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_SECONDS } from '@/lib/adminAuth';

/**
 * Plain Server Action, not useActionState — matches the rest of this app's
 * form conventions (GET/POST forms that work before hydration finishes).
 * Errors are reported via a redirect + ?error=1 query param the login page
 * reads back, rather than client-side state.
 */
export async function loginAction(formData) {
  const password = String(formData.get('password') || '');
  const nextParam = String(formData.get('next') || '/admin/conversations');
  const next = nextParam.startsWith('/admin') ? nextParam : '/admin/conversations';

  if (!verifyPassword(password)) {
    redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/admin',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });

  redirect(next);
}
