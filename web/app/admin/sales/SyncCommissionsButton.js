'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { syncCommissionsAction } from './actions';
import { BUTTON } from './styles';

/** Generate commissions for everything recorded since the last run. Safe to press twice. */
export default function SyncCommissionsButton() {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      let result;
      try {
        result = await syncCommissionsAction();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) router.refresh();
    });
  }

  return (
    <button type="button" className={BUTTON} onClick={run} disabled={pending}>
      <RefreshCw strokeWidth={ICON_STROKE_WIDTH} className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
      {t('admin.sales.sync')}
    </button>
  );
}
