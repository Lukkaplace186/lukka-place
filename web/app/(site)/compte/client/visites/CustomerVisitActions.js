'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { acceptViewingSlotAction, cancelViewingAction } from '../actions';

/**
 * "Accepter" (only on a slot the agent proposed) and "Annuler la visite" —
 * the same engine calls as the Messages tab's ViewingPanel. Cancelling asks
 * once more on the same button rather than through a dialog.
 *
 * `variant="royal"` is Accueil's "Réponse attendue" card: a white Accept on
 * royal blue, no cancel (that stays on the visit itself, one tap away).
 */
export default function CustomerVisitActions({ viewingId, status, variant = 'default' }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const royal = variant === 'royal';

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

  const button = 'u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[0.625rem] px-4 text-sm font-bold disabled:opacity-50';
  return (
    <>
      {status === 'RESCHEDULED' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(acceptViewingSlotAction)}
          className={cn(button, 'flex-1', royal ? 'bg-white text-blue-deep' : 'bg-blue text-white')}
        >
          <Check strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          {t('account.agenda.acceptShort')}
        </button>
      ) : null}
      {royal ? null : (
        <button
          type="button"
          disabled={pending}
          onClick={() => (confirmCancel ? run(cancelViewingAction) : setConfirmCancel(true))}
          className={cn(button, confirmCancel ? 'bg-danger text-white' : 'px-2.5 text-danger')}
        >
          {confirmCancel ? t('account.agenda.cancelConfirm') : t('account.agenda.cancel')}
        </button>
      )}
    </>
  );
}
