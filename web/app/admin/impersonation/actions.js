'use server';

import { cookies, headers } from 'next/headers';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { IMPERSONATION_REASON_MIN, landingPathFor, startImpersonation } from '@/lib/impersonation';
import { setImpersonationCookies } from '@/lib/impersonationCookies';
import { getT } from '@/lib/i18n/server';

/**
 * Start viewing the site as an agent or a customer. See lib/impersonation.js
 * for the rules; the ones enforced here are the permission, the individual
 * account (never the shared team password) and the audit entry.
 */
export async function startImpersonationAction(targetType, targetId, reason) {
  const t = await getT();
  try {
    const session = await requireAdmin('accounts.impersonate');
    if (session.shared || !session.id) return { ok: false, error: t('admin.impersonation.sharedRefused') };

    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    const ip = (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') || '').trim().slice(0, 64) || null;
    const result = await startImpersonation({
      adminId: session.id, targetType, targetId, reason, ip, userAgent: h.get('user-agent'),
    });
    if (result.errorKey) return { ok: false, error: t(result.errorKey, { min: IMPERSONATION_REASON_MIN }) };

    setImpersonationCookies(await cookies(), {
      adminId: session.id,
      adminTokenVersion: session.tokenVersion,
      targetType,
      session: result.session,
      target: result.target,
    });
    await recordAudit(session, {
      action: 'impersonation.start',
      entityType: targetType,
      entityId: result.target.id,
      details: {
        sessionId: result.session.id,
        reason: String(reason).trim().replace(/\s+/g, ' '),
        expiresAt: new Date(result.session.expiresAt).toISOString(),
        mode: 'read-only',
        replacedSessions: result.replaced,
      },
    });
    return { ok: true, redirectTo: landingPathFor(targetType) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
