'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { addNote, NOTE_ENTITY_TYPES } from '@/lib/adminNotes';
import { getT } from '@/lib/i18n/server';

const ENTITY_PATHS = {
  agent: (id) => `/admin/agents/${id}`,
  customer: (id) => `/admin/customers/${id}`,
  listing: (id) => `/admin/listings/${id}`,
  agency: (id) => `/admin/agencies/${id}`,
};

/** Add an internal note to an entity's timeline. */
export async function addAdminNoteAction(entityType, entityId, body) {
  const t = await getT();
  try {
    const session = await requireAdmin('notes.write');
    if (!NOTE_ENTITY_TYPES.includes(entityType)) return { ok: false, error: t('errors.actionFailed') };
    const text = String(body || '').trim();
    if (!text) return { ok: false, error: t('admin.notes.empty') };
    const id = await addNote(session, entityType, entityId, text);
    await recordAudit(session, { action: 'note.create', entityType, entityId, details: { noteId: id, length: text.length } });
    revalidatePath(ENTITY_PATHS[entityType](entityId));
    return { ok: true, message: t('admin.notes.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
