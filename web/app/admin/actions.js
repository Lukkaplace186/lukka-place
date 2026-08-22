'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { updateConversation, sendManualReply, updateLeadStatus } from '@/lib/adminApi';
import { ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';

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
