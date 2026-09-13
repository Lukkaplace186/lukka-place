'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, LockOpen, MessagesSquare } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import PasswordResetForm from '../PasswordResetForm';

const ICON_BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-ink transition-colors hover:border-blue disabled:opacity-50';

/**
 * Per-row actions on /admin/customers. The password form opens in a dialog
 * instead of expanding inside the row, so a table of 25 customers stays 25
 * rows tall. Both server actions arrive already bound to this customer's id
 * by the page — the id never travels through the browser.
 */
export default function CustomerRowActions({ phone, isLocked, resetAction, unlockAction, leadsHref }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function unlock() {
    startTransition(async () => {
      let result;
      try {
        result = await unlockAction();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={ICON_BUTTON} onClick={() => setOpen(true)} title={t('admin.password.title')}>
        <KeyRound strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">{t('admin.customers.resetPassword')}</span>
      </button>
      {isLocked ? (
        <button type="button" className={ICON_BUTTON} onClick={unlock} disabled={pending} title={t('admin.customers.unlock')}>
          <LockOpen strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t('admin.customers.unlock')}</span>
        </button>
      ) : null}
      <Link href={leadsHref} className={ICON_BUTTON} title={t('admin.customers.viewEnquiries')}>
        <MessagesSquare strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      </Link>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.password.title')}</DialogTitle>
            <DialogDescription>{`+${phone}`}</DialogDescription>
          </DialogHeader>
          <PasswordResetForm action={resetAction} accountLabel={`+${phone}`} compact />
        </DialogContent>
      </Dialog>
    </div>
  );
}
