'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { reviewVerificationDocument, setAgentVerificationLevel } from '@/lib/agentVerification';

/**
 * Only ever back into the verification queue — `return_to` comes from the
 * form, and a form field is not somewhere a redirect target is taken from
 * unchecked.
 */
function returnPath(formData) {
  const raw = String(formData.get('return_to') || '');
  return raw.startsWith('/admin/verifications') && !raw.startsWith('//') ? raw : '/admin/verifications';
}

function withParam(path, key, value) {
  const url = new URL(path, 'http://console.local');
  for (const flash of ['flash', 'lowered', 'level_error', 'level_saved']) url.searchParams.delete(flash);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function revalidateAgentSurfaces(agentId) {
  revalidatePath('/admin/verifications');
  revalidatePath(`/admin/agents/${agentId}`);
  revalidatePath(`/agents/${agentId}`);
  revalidatePath('/agents');
}

export async function reviewVerificationDocumentAction(formData) {
  const session = await requireAdmin('agents.manage');
  const back = returnPath(formData);
  const id = Number.parseInt(formData.get('document_id'), 10);
  const status = String(formData.get('status') || '');
  const note = String(formData.get('note') || '').trim();

  if (!Number.isFinite(id) || !['approved', 'rejected'].includes(status)) redirect(withParam(back, 'flash', 'invalid'));
  // The agent reads this reason on their settings page; a bare "Refusé" tells
  // them nothing they can fix.
  if (status === 'rejected' && !note) redirect(withParam(back, 'flash', 'note_required'));

  const result = await reviewVerificationDocument(id, { status, note: note || null, adminId: session.id });
  if (!result) redirect(withParam(back, 'flash', 'invalid'));

  // Details never carry the note body or the file — the audit log is readable
  // by owners and exportable.
  await recordAudit(session, {
    action: `verification.document.${status}`,
    entityType: 'agent',
    entityId: result.document.agent_id,
    details: { documentId: id, docType: result.document.doc_type, levelChange: result.level },
  });
  if (result.level) {
    await recordAudit(session, {
      action: 'verification.level.lowered',
      entityType: 'agent',
      entityId: result.document.agent_id,
      details: { ...result.level, reason: 'document_rejected', documentId: id },
    });
  }

  revalidateAgentSurfaces(result.document.agent_id);
  redirect(result.level ? withParam(back, 'lowered', result.level.to) : withParam(back, 'flash', 'reviewed'));
}

export async function setAgentVerificationLevelAction(formData) {
  const session = await requireAdmin('agents.manage');
  const back = returnPath(formData);
  const agentId = Number.parseInt(formData.get('agent_id'), 10);
  const level = String(formData.get('level') || '');

  if (!Number.isFinite(agentId)) redirect(withParam(back, 'level_error', 'not_found'));

  const result = await setAgentVerificationLevel(agentId, level, { adminId: session.id });
  if (!result.ok) redirect(withParam(back, 'level_error', result.code));

  await recordAudit(session, {
    action: 'verification.level.set',
    entityType: 'agent',
    entityId: agentId,
    details: { from: result.from, to: result.to },
  });

  revalidateAgentSurfaces(agentId);
  redirect(withParam(back, 'level_saved', '1'));
}
