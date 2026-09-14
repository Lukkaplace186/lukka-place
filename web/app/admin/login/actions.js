'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMIN_SESSION_COOKIE, ADMIN_SESSION_COOKIE_OPTIONS, createSessionToken, sharedPasswordEnabled, verifyPassword,
} from '@/lib/adminAuth';
import { authenticateAdmin, ipIsThrottled, recordSharedPasswordAttempt } from '@/lib/adminUsers';
import { recordAudit } from '@/lib/adminAudit';

/**
 * Plain Server Actions with redirect-based errors (`?error=<reason>`), so the
 * login form works before hydration and never echoes which part was wrong.
 */

function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin/dashboard';
}

async function clientIp() {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') || '').trim() || null;
}

/** Individual account: email + password, with per-account and per-IP lockout. */
export async function loginAction(formData) {
  const next = safeNext(formData.get('next'));
  const result = await authenticateAdmin({
    email: formData.get('email'),
    password: formData.get('password'),
    ip: await clientIp(),
  });
  if (!result.ok) {
    redirect(`/admin/login?error=${result.reason}&next=${encodeURIComponent(next)}`);
  }

  const { user } = result;
  (await cookies()).set(
    ADMIN_SESSION_COOKIE,
    createSessionToken({ adminId: user.id, tokenVersion: user.token_version }),
    ADMIN_SESSION_COOKIE_OPTIONS,
  );
  await recordAudit(
    { id: user.id, shared: false, name: user.full_name, email: user.email },
    { action: 'session.login', entityType: 'team', entityId: user.id },
  );
  redirect(next);
}

/**
 * The legacy shared team password — kept so the team can reach the console to
 * create the first individual accounts. Same per-IP throttle as account logins.
 */
export async function sharedLoginAction(formData) {
  const next = safeNext(formData.get('next'));
  if (!sharedPasswordEnabled()) redirect(`/admin/login?error=disabled&next=${encodeURIComponent(next)}`);

  const ip = await clientIp();
  if (await ipIsThrottled(ip)) redirect(`/admin/login?error=throttled&next=${encodeURIComponent(next)}`);

  const ok = verifyPassword(String(formData.get('password') || ''));
  await recordSharedPasswordAttempt(ip, ok);
  if (!ok) redirect(`/admin/login?error=invalid&shared=1&next=${encodeURIComponent(next)}`);

  (await cookies()).set(ADMIN_SESSION_COOKIE, createSessionToken(), ADMIN_SESSION_COOKIE_OPTIONS);
  await recordAudit({ id: null, shared: true }, { action: 'session.login_shared', entityType: 'session' });
  redirect(next);
}
