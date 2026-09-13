'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { nudgeViewingAction } from '../viewings/actions';

/** One-click re-engagement ping for an agent sitting on a request. */
export default function NudgeButton({ viewingRequestId }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          let result;
          try {
            result = await nudgeViewingAction(viewingRequestId);
          } catch (err) {
            result = { ok: false, error: err.message };
          }
          showToast({ type: result.ok ? 'success' : 'error', message: result.ok ? result.message : result.error });
          if (result.ok) router.refresh();
        })
      }
      className="u-press u-micro-strong rounded-md border border-line bg-surface px-2.5 py-1.5 text-ink transition-colors hover:border-blue disabled:opacity-50"
    >
      {t('admin.viewings.nudge')}
    </button>
  );
}
