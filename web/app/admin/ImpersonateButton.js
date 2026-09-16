'use client';

import { useState, useTransition } from 'react';
import { ScanEye } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { startImpersonationAction } from './impersonation/actions';

const REASON_MIN = 10;
const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink transition-colors hover:border-blue disabled:opacity-50';

/** The confirmation every "view as" goes through: who, why, and what it will and will not do. */
export function ImpersonateDialog({ open, onOpenChange, targetType, targetId, targetLabel, sharedSession = false }) {
  const t = useT();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < REASON_MIN;

  function confirm() {
    startTransition(async () => {
      let result;
      try {
        result = await startImpersonationAction(targetType, targetId, reason);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (result?.ok) {
        // A full navigation, not router.push: the target's own layouts and
        // cookies must be read fresh.
        window.location.assign(result.redirectTo);
      } else {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setReason(''); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('admin.impersonation.dialogTitle', { name: targetLabel })}</DialogTitle>
          <DialogDescription>{t(targetType === 'agent' ? 'admin.impersonation.introAgent' : 'admin.impersonation.introCustomer')}</DialogDescription>
        </DialogHeader>
        <ul className="u-micro flex list-disc flex-col gap-1 pl-5 text-ink-70">
          <li>{t('admin.impersonation.ruleReadOnly')}</li>
          <li>{t('admin.impersonation.ruleExpiry')}</li>
          <li>{t('admin.impersonation.ruleLogged')}</li>
        </ul>
        {sharedSession ? (
          <p className="u-micro rounded-md bg-warning-tint p-3 text-ink-70">{t('admin.impersonation.sharedRefused')}</p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink">{t('admin.impersonation.reasonLabel')}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t('admin.impersonation.reasonPlaceholder')}
              className="u-micro rounded-lg border border-line bg-surface p-2 text-ink focus:border-blue focus:outline-none"
            />
            <span className="u-micro text-ink-45">{t('admin.impersonation.reasonHint', { min: REASON_MIN })}</span>
          </label>
        )}
        <DialogFooter>
          <button type="button" className={BUTTON} onClick={() => onOpenChange(false)}>{t('common.actions.cancel')}</button>
          <button
            type="button"
            className={`${BUTTON} border-blue text-blue-deep`}
            disabled={sharedSession || pending || tooShort}
            onClick={confirm}
          >
            <ScanEye strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.impersonation.confirm')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ImpersonateButton({ targetType, targetId, targetLabel, sharedSession = false, compact = false }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={BUTTON}
        aria-label={t('admin.impersonation.button')}
        title={t('admin.impersonation.button')}
      >
        <ScanEye strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {compact ? null : t('admin.impersonation.button')}
      </button>
      <ImpersonateDialog
        open={open}
        onOpenChange={setOpen}
        targetType={targetType}
        targetId={targetId}
        targetLabel={targetLabel}
        sharedSession={sharedSession}
      />
    </>
  );
}
