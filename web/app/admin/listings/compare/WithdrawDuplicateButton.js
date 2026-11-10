'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EyeOff } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { withdrawDuplicateAction } from './actions';

/** Takes a live copy offline because the same agent has the same property online as `keepId`. */
export default function WithdrawDuplicateButton({ id, keepId }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function withdraw() {
    startTransition(async () => {
      try {
        const result = await withdrawDuplicateAction({ id, keepId });
        if (!result?.ok) {
          showToast({ type: 'error', message: result?.error || t('admin.moderation.compare.failed') });
          return;
        }
        setDone(true);
        showToast({ message: t('admin.moderation.compare.withdrawn', { id, keep: keepId }) });
        router.refresh();
      } catch {
        showToast({ type: 'error', message: t('admin.moderation.compare.failed') });
      }
    });
  }

  if (done) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={withdraw}
      className="u-press u-micro-strong inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger-tint px-3 text-danger transition-colors hover:border-danger disabled:opacity-50"
    >
      <EyeOff strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      {t('admin.moderation.compare.withdraw', { keep: keepId })}
    </button>
  );
}
