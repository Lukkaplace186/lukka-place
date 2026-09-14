'use server';

import { requireAdmin } from '@/lib/adminSession';
import { deleteView, saveView } from '@/lib/adminSavedViews';
import { getT } from '@/lib/i18n/server';

/** Saved views belong to a person, so the shared-password session cannot keep any. */
export async function saveViewAction(path, name, query) {
  const t = await getT();
  try {
    const session = await requireAdmin();
    if (!session.id) return { ok: false, error: t('admin.views.needAccount') };
    const result = await saveView(session.id, path, name, query);
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    return { ok: true, message: t('admin.views.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function deleteViewAction(id) {
  const t = await getT();
  try {
    const session = await requireAdmin();
    if (!session.id) return { ok: false, error: t('admin.views.needAccount') };
    await deleteView(session.id, Number(id));
    return { ok: true, message: t('admin.views.deleted') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
