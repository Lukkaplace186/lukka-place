'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  updateConversation,
  sendManualReply,
  updateLeadStatus,
  assignLead,
  redispatchLead,
} from '@/lib/adminApi';
import { ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';
import { getAdminSession, requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { getAgentById } from '@/lib/agents';
import { agentDisplayName } from '@/lib/agencies';

/**
 * Server Actions backing the older /admin form controls (conversation detail
 * page, leads list). Each checks the caller's role itself — Server Actions are
 * public POST endpoints and do not pass through the admin layout — and records
 * what it did in the audit log.
 */

export async function assignAgentAction(conversationId, formData) {
  const session = await requireAdmin('conversations.reply');
  const agent = String(formData.get('assigned_agent') || '').trim();
  await updateConversation(conversationId, { assigned_agent: agent || null });
  await recordAudit(session, { action: 'conversation.assign', entityType: 'conversation', entityId: conversationId, details: { agent: agent || null } });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath('/admin/conversations');
}

export async function saveNotesAction(conversationId, formData) {
  const session = await requireAdmin('conversations.reply');
  const notes = String(formData.get('notes') || '');
  await updateConversation(conversationId, { notes });
  await recordAudit(session, { action: 'conversation.notes', entityType: 'conversation', entityId: conversationId, details: { length: notes.length } });
  revalidatePath(`/admin/conversations/${conversationId}`);
}

/** "Take over" — AI goes silent, a human owns the conversation from here (product spec §17/§19). */
export async function takeOverAction(conversationId) {
  const session = await requireAdmin('conversations.reply');
  await updateConversation(conversationId, { ai_active: false, state: 'HUMAN_HANDOFF' });
  await recordAudit(session, { action: 'conversation.take_over', entityType: 'conversation', entityId: conversationId });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath('/admin/conversations');
}

/** "Return to AI" — the assistant resumes automatic replies. */
export async function returnToAiAction(conversationId) {
  const session = await requireAdmin('conversations.reply');
  await updateConversation(conversationId, { ai_active: true, state: 'COLLECTING_REQUIREMENTS' });
  await recordAudit(session, { action: 'conversation.return_ai', entityType: 'conversation', entityId: conversationId });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath('/admin/conversations');
}

export async function sendReplyAction(conversationId, formData) {
  const session = await requireAdmin('conversations.reply');
  const text = String(formData.get('text') || '').trim();
  if (!text) return;
  await sendManualReply(conversationId, text);
  // The length, not the message: the transcript already holds the text, and
  // the audit log should not become a second copy of customer conversations.
  await recordAudit(session, { action: 'conversation.reply', entityType: 'conversation', entityId: conversationId, details: { length: text.length } });
  revalidatePath(`/admin/conversations/${conversationId}`);
}

export async function updateLeadStatusAction(leadId, formData) {
  const session = await requireAdmin('leads.manage');
  const status = String(formData.get('status') || '');
  if (!status) return;
  await updateLeadStatus(leadId, status);
  await recordAudit(session, { action: 'lead.status', entityType: 'lead', entityId: leadId, details: { status } });
  revalidatePath('/admin/leads');
}

/**
 * Request Assignment Routing. The engine's leads table is SQLite-only and
 * has no Postgres access, so it can't resolve an agent id to a display
 * name itself — that resolution happens here, then both the real id and
 * the display-name string are sent together (see services/db.js's
 * assignLead doc comment, engine repo). An empty selection un-assigns.
 */
export async function assignLeadAction(leadId, formData) {
  const session = await requireAdmin('leads.manage');

  const raw = formData.get('agent_id');
  const agentId = raw ? Number.parseInt(raw, 10) : null;

  let assignedAgent = null;
  if (agentId !== null) {
    const agent = await getAgentById(agentId);
    if (!agent) throw new Error(`No agent #${agentId}`);
    assignedAgent = agentDisplayName(agent);
  }

  await assignLead(leadId, { agentId, assignedAgent });
  await recordAudit(session, { action: 'lead.assign', entityType: 'lead', entityId: leadId, details: { agentId } });
  revalidatePath('/admin/leads');
}

export async function logoutAction() {
  const session = await getAdminSession();
  if (session) await recordAudit(session, { action: 'session.logout', entityType: 'session', entityId: session.id });
  const cookieStore = await cookies();
  // Must match the `path` the cookie was SET with (`path: '/admin'`) — cookies
  // with different Path attributes are distinct to the browser even with the
  // same name, so `.delete(name)` alone would leave the real session intact.
  cookieStore.delete({ name: ADMIN_SESSION_COOKIE, path: '/admin' });
  redirect('/admin/login');
}

/**
 * Manual re-dispatch of one request to the best-matching agencies. Agencies
 * already notified are skipped by the engine's own UNIQUE (lead_id, agent_id)
 * constraint, so this is safe to press twice.
 */
export async function redispatchLeadAction(leadId) {
  const session = await requireAdmin('leads.manage');
  const result = await redispatchLead(leadId);
  await recordAudit(session, {
    action: 'lead.redispatch',
    entityType: 'lead',
    entityId: leadId,
    details: { notified: result.notified ?? 0, failed: result.failed ?? 0, skipped: result.skipped ?? null },
  });
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath('/admin/matching');
}
