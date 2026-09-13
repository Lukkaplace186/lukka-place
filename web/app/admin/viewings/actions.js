'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { nudgeViewingRequest, reassignViewingRequest, scheduleViewingRequest } from '@/lib/adminApi';
import { getT } from '@/lib/i18n/server';

/** Same defense-in-depth pattern as web/app/admin/agents/actions.js. */
async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

function revalidateRoutingPages() {
  revalidatePath('/admin/viewings');
  revalidatePath('/admin/telemetry');
}

/** Admin override: hand a request to another verified agent. */
export async function reassignViewingAction(viewingRequestId, agentId) {
  const t = await getT();
  try {
    await assertAdminSession();
    const result = await reassignViewingRequest(viewingRequestId, agentId);
    revalidateRoutingPages();
    return {
      ok: true,
      message: result.agentNotified
        ? t('admin.viewings.reassignedNotified')
        : t('admin.viewings.reassignedNotNotified'),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Pin the appointment to a real instant. `datetime-local` carries no zone and
 * the admin types Kinshasa wall-clock time, which is UTC+1 all year (no DST),
 * so the offset is appended here, once — the engine stores UTC.
 */
export async function scheduleViewingAction(viewingRequestId, localValue) {
  const t = await getT();
  try {
    await assertAdminSession();
    const text = String(localValue || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
      return { ok: false, error: t('admin.viewings.invalidTime') };
    }
    await scheduleViewingRequest(viewingRequestId, `${text}:00+01:00`);
    revalidateRoutingPages();
    return { ok: true, message: t('admin.viewings.scheduled') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Re-engagement ping — resend the current agent's alert. */
export async function nudgeViewingAction(viewingRequestId) {
  const t = await getT();
  try {
    await assertAdminSession();
    await nudgeViewingRequest(viewingRequestId);
    revalidateRoutingPages();
    return { ok: true, message: t('admin.viewings.nudged') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
