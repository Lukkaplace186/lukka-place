'use client';

import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { sendProjectToAgenciesAction } from './actions';

const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink transition-colors hover:border-blue disabled:opacity-50';
const PRIMARY = 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-blue px-2.5 text-white transition-colors hover:bg-blue-deep disabled:opacity-50';

/**
 * "Envoyer aux agences" for a project that never went (actions.js). It
 * messages real agencies, so it says who will be told and asks first.
 */
export default function SendProjectButton({ customerId, projectId, customerLabel }) {
  const t = useT();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      let result;
      try {
        result = await sendProjectToAgenciesAction(customerId, projectId);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (result?.ok) {
        setDone(true);
        setOpen(false);
        showToast({ type: 'success', message: result.message });
      } else {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
      }
    });
  }

  if (done) return <span className="u-micro-strong text-green-deep">{t('admin.moveProjects.sentShort')}</span>;

  return (
    <>
      <button type="button" className={`${BUTTON} mt-1`} onClick={() => setOpen(true)}>
        <Send strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.moveProjects.send')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.moveProjects.sendTitle')}</DialogTitle>
            <DialogDescription>{t('admin.moveProjects.sendIntro', { name: customerLabel })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setOpen(false)}>{t('common.actions.cancel')}</button>
            <button type="button" className={PRIMARY} onClick={confirm} disabled={pending}>
              {pending ? t('admin.moveProjects.sending') : t('admin.moveProjects.sendConfirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
