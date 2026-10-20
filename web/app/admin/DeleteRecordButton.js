'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * A "Supprimer" with its confirmation, for records that are deleted for good
 * (prospects, visits). `action` is a bound server action returning
 * { ok, message | error }; `redirectTo` leaves a page whose record is gone.
 */
export default function DeleteRecordButton({ action, title, body, label, redirectTo = null, compact = false }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
      if (!result?.ok) return;
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={compact
          ? 'u-press inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-danger hover:bg-danger/5'
          : 'u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-surface px-3 text-danger hover:bg-danger/5'}
      >
        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className={compact ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        {compact ? null : label}
      </button>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="u-press inline-flex h-9 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-canvas-alt"
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={confirm}
              className="u-press inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {label}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
