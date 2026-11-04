'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { MANUAL_EXCLUSION_CODES } from '@/lib/marketObservationRules';
import { setExclusionAction } from './actions';

/**
 * Status of one observation and, for market.manage, exclude / restore.
 * An automatic exclusion (price out of range, francs, short stay…) is shown
 * with its reason and cannot be restored: the figure itself is what is wrong.
 */
export default function ExclusionControl({ id, reason, canManage }) {
  const t = useT();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const manual = reason?.startsWith('manual:');
  const label = reason
    ? t(`admin.marketObservations.reasons.${manual ? reason.slice(7) : reason}`)
    : t('admin.marketObservations.counted');

  const run = (nextCode) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setExclusionAction(id, nextCode);
        if (!result.ok) { setError(result.error); return; }
        router.refresh();
      } catch {
        setError(t('errors.actionFailed'));
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <span className={reason ? 'text-warning' : 'text-success'}>{label}</span>
      {canManage && !reason ? (
        <div className="flex items-center gap-1">
          <select value={code} onChange={(event) => setCode(event.target.value)} className="u-micro h-8 rounded-lg border border-line bg-surface px-2 text-ink" aria-label={t('admin.marketObservations.excludeReason')}>
            <option value="">{t('admin.marketObservations.excludeReason')}</option>
            {MANUAL_EXCLUSION_CODES.map((c) => <option key={c} value={c}>{t(`admin.marketObservations.reasons.${c}`)}</option>)}
          </select>
          <button type="button" disabled={!code || pending} onClick={() => run(code)} className="u-micro-strong h-8 rounded-lg border border-line px-2 text-ink hover:border-danger disabled:opacity-50">
            {t('admin.marketObservations.exclude')}
          </button>
        </div>
      ) : null}
      {canManage && manual ? (
        <button type="button" disabled={pending} onClick={() => run(null)} className="u-micro-strong h-8 self-start rounded-lg border border-line px-2 text-ink hover:border-blue disabled:opacity-50">
          {t('admin.marketObservations.restore')}
        </button>
      ) : null}
      {error ? <span role="alert" className="text-danger">{error}</span> : null}
    </div>
  );
}
