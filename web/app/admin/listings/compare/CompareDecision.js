'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { moderateListingsAction } from '../actions';

const BUTTON =
  'u-press u-micro-strong inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 transition-colors disabled:opacity-50';

/**
 * Approve, or reject as a duplicate, one pending listing from the comparison.
 * Same action as the queue (moderateListingsAction): the publishability check
 * runs on approve, and a rejection is stored with reason DUPLICATE and told to
 * the agent like any other.
 */
export default function CompareDecision({ id }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(null);

  function decide(decision) {
    startTransition(async () => {
      try {
        const result = await moderateListingsAction({
          ids: [id],
          decision,
          reasonCode: decision === 'reject' ? 'DUPLICATE' : undefined,
          // Approving here is deliberate: the other copy is on screen.
          confirmResend: decision === 'approve',
        });
        if (!result?.ok) {
          showToast({ type: 'error', message: result?.error || t('admin.moderation.compare.failed') });
          return;
        }
        if (result.skipped?.length) {
          showToast({ type: 'error', message: result.skipped[0].reason });
          return;
        }
        setDone(decision);
        showToast({ message: t(decision === 'approve' ? 'admin.moderation.compare.approved' : 'admin.moderation.compare.rejected', { id }) });
        router.refresh();
      } catch {
        showToast({ type: 'error', message: t('admin.moderation.compare.failed') });
      }
    });
  }

  if (done) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide('reject')}
        className={`${BUTTON} border-danger/40 bg-danger-tint text-danger hover:border-danger`}
      >
        <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('admin.moderation.compare.rejectDuplicate')}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide('approve')}
        className={`${BUTTON} border-line bg-surface text-ink hover:border-blue`}
      >
        <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" />
        {t('admin.moderation.compare.approve')}
      </button>
    </div>
  );
}
