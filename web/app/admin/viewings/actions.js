'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import {
  nudgeViewingRequest, reassignViewingRequest, recordViewingDirectContact, scheduleViewingRequest, updateViewingRequest,
} from '@/lib/adminApi';

const DIRECT_CONTACT_CHANNELS = ['whatsapp', 'phone', 'in_person', 'other'];
import { getT } from '@/lib/i18n/server';

function revalidateRoutingPages() {
  revalidatePath('/admin/viewings');
  revalidatePath('/admin/telemetry');
  revalidatePath('/admin/dashboard');
}

/** Admin override: hand a request to another verified agent. */
export async function reassignViewingAction(viewingRequestId, agentId) {
  const t = await getT();
  try {
    const session = await requireAdmin('viewings.manage');
    const result = await reassignViewingRequest(viewingRequestId, agentId);
    await recordAudit(session, {
      action: 'viewing.reassign',
      entityType: 'viewing',
      entityId: viewingRequestId,
      details: { agentId, agentNotified: Boolean(result.agentNotified) },
    });
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
 * the admin types Kinshasa wall-clock time (UTC+1, no DST), so the offset is
 * appended here, once — the engine stores UTC.
 */
export async function scheduleViewingAction(viewingRequestId, localValue) {
  const t = await getT();
  try {
    const session = await requireAdmin('viewings.manage');
    const text = String(localValue || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
      return { ok: false, error: t('admin.viewings.invalidTime') };
    }
    await scheduleViewingRequest(viewingRequestId, `${text}:00+01:00`);
    await recordAudit(session, { action: 'viewing.schedule', entityType: 'viewing', entityId: viewingRequestId, details: { at: `${text}+01:00` } });
    revalidateRoutingPages();
    return { ok: true, message: t('admin.viewings.scheduled') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Admin override: call the visit off. `CANCELLED`, never `DECLINED` — the agent
 * did not refuse it. Nobody is messaged, which the dialog says first.
 */
export async function cancelViewingAction(viewingRequestId) {
  const t = await getT();
  try {
    const session = await requireAdmin('viewings.manage');
    await updateViewingRequest(viewingRequestId, { status: 'CANCELLED' });
    await recordAudit(session, { action: 'viewing.cancel', entityType: 'viewing', entityId: viewingRequestId });
    revalidateRoutingPages();
    return { ok: true, message: t('admin.viewings.cancelled') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * The agent told the desk they already wrote to or called the customer from
 * their own phone — a chat we cannot see. Recorded on the request (the SLA
 * escalation stops); nobody is messaged.
 */
export async function recordDirectContactAction(viewingRequestId, channel) {
  const t = await getT();
  try {
    const session = await requireAdmin('viewings.manage');
    if (!DIRECT_CONTACT_CHANNELS.includes(channel)) return { ok: false, error: t('admin.viewings.actionFailed') };
    const result = await recordViewingDirectContact(viewingRequestId, { channel, by: 'DESK' });
    await recordAudit(session, {
      action: 'viewing.direct_contact',
      entityType: 'viewing',
      entityId: viewingRequestId,
      details: { channel, recorded: Boolean(result.recorded) },
    });
    revalidateRoutingPages();
    return { ok: true, message: result.recorded ? t('admin.viewings.contactRecorded') : t('admin.viewings.contactAlreadyRecorded') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Re-engagement ping — resend the current agent's alert. */
export async function nudgeViewingAction(viewingRequestId) {
  const t = await getT();
  try {
    const session = await requireAdmin('viewings.manage');
    await nudgeViewingRequest(viewingRequestId);
    await recordAudit(session, { action: 'viewing.nudge', entityType: 'viewing', entityId: viewingRequestId });
    revalidateRoutingPages();
    return { ok: true, message: t('admin.viewings.nudged') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
