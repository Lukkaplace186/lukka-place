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
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { getAgentById } from '@/lib/agents';
import { agentDisplayName } from '@/lib/agencies';

/** Same defense-in-depth pattern as web/app/admin/agents/actions.js. */
async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

/**
 * Server Actions backing the /admin/* dashboard forms. Each one is a thin
 * wrapper over lib/adminApi.js (which itself just calls the engine's
 * routes/admin.js) plus a revalidatePath so the page reflects the change
 * immediately — no client-side state to keep in sync.
 */

export async function assignAgentAction(conversationId, formData) {
  const agent = String(formData.get('assigned_agent') || '').trim();
  await updateConversation(conversationId, { assigned_agent: agent || null });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath('/admin/conversations');
}

export async function saveNotesAction(conversationId, formData) {
  const notes = String(formData.get('notes') || '');
  await updateConversation(conversationId, { notes });
  revalidatePath(`/admin/conversations/${conversationId}`);
}

/** "Take over" — AI goes silent, a human owns the conversation from here (product spec §17/§19). */
export async function takeOverAction(conversationId) {
  await updateConversation(conversationId, { ai_active: false, state: 'HUMAN_HANDOFF' });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath('/admin/conversations');
}

/** "Return to AI" — the assistant resumes automatic replies. */
export async function returnToAiAction(conversationId) {
  await updateConversation(conversationId, { ai_active: true, state: 'COLLECTING_REQUIREMENTS' });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath('/admin/conversations');
}

export async function sendReplyAction(conversationId, formData) {
  const text = String(formData.get('text') || '').trim();
  if (!text) return;
  await sendManualReply(conversationId, text);
  revalidatePath(`/admin/conversations/${conversationId}`);
}

export async function updateLeadStatusAction(leadId, formData) {
  const status = String(formData.get('status') || '');
  if (!status) return;
  await updateLeadStatus(leadId, status);
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
  await assertAdminSession();

  const raw = formData.get('agent_id');
  const agentId = raw ? Number.parseInt(raw, 10) : null;

  let assignedAgent = null;
  if (agentId !== null) {
    const agent = await getAgentById(agentId);
    if (!agent) throw new Error(`No agent #${agentId}`);
    assignedAgent = agentDisplayName(agent);
  }

  await assignLead(leadId, { agentId, assignedAgent });
  revalidatePath('/admin/leads');
}

export async function logoutAction() {
  const cookieStore = await cookies();
  // Must match the `path` the cookie was SET with (login/actions.js uses
  // `path: '/admin'`) — cookies with different Path attributes are distinct
  // to the browser even with the same name, so `.delete(name)` alone (which
  // defaults to path '/') creates a second, harmless deletion cookie at '/'
  // while leaving the real '/admin'-scoped session cookie completely intact.
  // Caught by real QA: logging out and revisiting /admin/leads directly
  // still showed the dashboard.
  cookieStore.delete({ name: ADMIN_SESSION_COOKIE, path: '/admin' });
  redirect('/admin/login');
}

/**
 * Manual re-dispatch of one request to the best-matching agencies.
 *
 * Two real cases the automatic creation-time trigger cannot cover: a request
 * that arrived when no agency covered its commune, and one whose commune an
 * admin has since corrected. Agencies already notified are skipped by the
 * engine's own UNIQUE (lead_id, agent_id) constraint, so this is safe to
 * press twice — it will never double-message anyone.
 */
export async function redispatchLeadAction(leadId) {
  await assertAdminSession();
  const result = await redispatchLead(leadId);
  console.log(
    `[admin] re-dispatched lead #${leadId}: ${result.notified ?? 0} notified, ` +
      `${result.failed ?? 0} failed${result.skipped ? ` (skipped: ${result.skipped})` : ''}`,
  );
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath('/admin/matching');
}
