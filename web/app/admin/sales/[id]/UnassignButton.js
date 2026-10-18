'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserMinus } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * "Retirer" for one agent or one agency, behind a confirmation: ending an
 * assignment stops the rep earning on that account from now on, and nothing
 * re-assigns it automatically. History and commissions already earned stay.
 */
export default function UnassignButton({ title, body, action, compact = false }) {
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
      setOpen(false);
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
      if (result?.ok) router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        title={t('admin.sales.accounts.unassign')}
        aria-label={`${t('admin.sales.accounts.unassign')} — ${title}`}
        className={compact
          ? 'u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-danger disabled:opacity-50'
          : 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink hover:border-danger hover:text-danger disabled:opacity-50'}
      >
        <UserMinus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {compact ? null : t('admin.sales.accounts.unassign')}
      </button>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.sales.accounts.unassignTitle', { name: title })}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className="u-btn-secondary u-press inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-ink">
              {t('common.actions.cancel')}
            </button>
            <button type="button" disabled={pending} onClick={confirm} className="u-press inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
              <UserMinus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.sales.accounts.unassign')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
