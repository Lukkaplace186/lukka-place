'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { acceptViewingSlotAction, cancelViewingAction } from '../actions';

/**
 * "Accepter ce créneau" (only on a slot the agent proposed) and "Annuler" —
 * the same engine calls as the Messages tab's ViewingPanel. Cancelling asks
 * once more on the same button rather than through a dialog.
 */
export default function CustomerVisitActions({ viewingId, status }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  function run(action) {
    startTransition(async () => {
      let result;
      try {
        result = await action(viewingId);
      } catch {
        result = { ok: false, error: t('account.agenda.actionFailed') };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('account.agenda.actionFailed') });
      if (result?.ok) router.refresh();
      setConfirmCancel(false);
    });
  }

  const button = 'u-press inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold disabled:opacity-50';
  return (
    <>
      {status === 'RESCHEDULED' ? (
        <button type="button" disabled={pending} onClick={() => run(acceptViewingSlotAction)} className={`${button} bg-blue text-white`}>
          {t('account.agenda.acceptSlot')}
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirmCancel ? run(cancelViewingAction) : setConfirmCancel(true))}
        className={`${button} ${confirmCancel ? 'bg-danger text-white' : 'border border-line text-danger'}`}
      >
        {confirmCancel ? t('account.agenda.cancelConfirm') : t('account.agenda.cancel')}
      </button>
    </>
  );
}
