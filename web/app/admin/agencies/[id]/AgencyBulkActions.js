'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { bulkUpdateAgentStatusAction } from '../../agents/bulkActions';

const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';

/** Activate or suspend every agent of one agency, after a confirmation that names the count. */
export default function AgencyBulkActions({ agentIds, agencyName }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(null);

  function apply(status) {
    startTransition(async () => {
      let result;
      try {
        result = await bulkUpdateAgentStatusAction(agentIds, status);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      setConfirming(null);
      if (result?.ok) router.refresh();
    });
  }

  if (agentIds.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={pending} onClick={() => setConfirming(1)}>
          <PlayCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.agencies.activateAll', { count: agentIds.length })}
        </button>
        <button type="button" className={`${BUTTON} text-danger`} disabled={pending} onClick={() => setConfirming(0)}>
          <PauseCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.agencies.suspendAll', { count: agentIds.length })}
        </button>
      </div>
      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirming === 0 ? t('admin.agencies.suspendAllTitle') : t('admin.agencies.activateAllTitle')}</DialogTitle>
            <DialogDescription>{t('admin.agencies.bulkConfirm', { count: agentIds.length, agency: agencyName })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setConfirming(null)}>{t('common.actions.cancel')}</button>
            <button type="button" className={`${BUTTON} ${confirming === 0 ? 'border-danger text-danger' : ''}`} disabled={pending} onClick={() => apply(confirming)}>
              {t('admin.agencies.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
