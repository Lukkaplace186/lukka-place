'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { UNDO_TOAST_MS } from '@/lib/adminSoftDeleteRules';
import { useT } from '@/lib/i18n/client';
import { softDeleteAction, undoSoftDeleteAction } from './softDeleteActions';

/** The bulk bar's button, styled like its Activer / Suspendre neighbours. */
export function BulkDeleteButton({ onClick, disabled }) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-danger/80 px-2.5 hover:bg-danger"
    >
      <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      {t('admin.softDelete.deleteSelected')}
    </button>
  );
}

/**
 * "Supprimer la sélection" for one console table: the confirmation dialog,
 * the soft delete, and a toast with "Annuler" for 10 seconds
 * (lib/adminSoftDelete.js). The table renders `dialog` and calls
 * `request(ids)` from its bulk bar.
 *
 * @param {'agent'|'agency'|'listing'} entity
 * @param {{onDeleted?: () => void}} [options]
 */
export function useBulkDelete(entity, { onDeleted } = {}) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [ids, setIds] = useState(null);

  function undo(batchId) {
    startTransition(async () => {
      let result;
      try {
        result = await undoSoftDeleteAction(entity, batchId);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
      if (result?.ok) router.refresh();
    });
  }

  function confirm() {
    const selection = ids;
    startTransition(async () => {
      let result;
      try {
        result = await softDeleteAction(entity, selection);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      setIds(null);
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
        return;
      }
      onDeleted?.();
      router.refresh();
      showToast({
        type: 'success',
        message: result.message,
        duration: UNDO_TOAST_MS,
        action: { label: t('admin.softDelete.undo'), onClick: () => undo(result.batchId) },
      });
    });
  }

  const count = ids?.length || 0;
  const dialog = (
    <Dialog open={Boolean(ids)} onOpenChange={(open) => { if (!open && !pending) setIds(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('admin.softDelete.confirmTitle')}</DialogTitle>
          <DialogDescription>{t('admin.softDelete.confirmBody', { count })}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-ink-70">{t(`admin.softDelete.cascadeNote.${entity}`)}</p>
        <DialogFooter>
          <button
            type="button"
            disabled={pending}
            onClick={() => setIds(null)}
            className="u-btn-secondary u-press inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-ink"
          >
            {t('common.actions.cancel')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            className="u-press inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.softDelete.confirmButton', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { request: (selection) => setIds([...selection]), dialog, pending };
}
