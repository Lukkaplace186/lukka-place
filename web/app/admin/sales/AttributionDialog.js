'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { overrideAttributionAction } from './actions';
import { BUTTON, INPUT } from './styles';

/**
 * Attribute an agent to a rep by hand, or move them to another rep. Only
 * `sales.manage` sees it. A written reason (20+ characters) is required and
 * kept with the change; ledger lines already paid stay with the rep they were
 * paid to — the dialog says so before anyone confirms.
 */
export default function AttributionDialog({ agentId, agentLabel, currentRepId = null, currentRepName = null, reps, today, compact = false }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [repId, setRepId] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [creditFrom, setCreditFrom] = useState('');

  const options = reps.filter((rep) => String(rep.id) !== String(currentRepId));
  const reasonLength = reason.trim().length;

  function submit(event) {
    event.preventDefault();
    startTransition(async () => {
      let result;
      try {
        result = await overrideAttributionAction(agentId, repId, reason, evidence, creditFrom || null);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        setOpen(false);
        setReason('');
        setEvidence('');
        setRepId('');
        router.refresh();
      }
    });
  }

  const label = currentRepId ? t('admin.sales.attribution.change') : t('admin.sales.attribution.attribute');

  return (
    <>
      <button
        type="button"
        className={compact
          ? 'u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-ink'
          : BUTTON}
        onClick={() => setOpen(true)}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
      >
        <ArrowRightLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {compact ? null : label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription>
                {currentRepId
                  ? t('admin.sales.attribution.moveHint', { agent: agentLabel, rep: currentRepName || '—' })
                  : t('admin.sales.attribution.attributeHint', { agent: agentLabel })}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.attribution.toRep')}</span>
              <select required value={repId} onChange={(event) => setRepId(event.target.value)} className={INPUT}>
                <option value="">{t('admin.sales.agentRep.choose')}</option>
                {options.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.attribution.reason')}</span>
              <textarea
                required
                minLength={20}
                maxLength={1000}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="u-micro w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:border-blue focus:outline-none"
              />
              <span className={`u-micro ${reasonLength > 0 && reasonLength < 20 ? 'text-danger' : 'text-ink-45'}`}>
                {t('admin.sales.attribution.reasonHint', { count: reasonLength })}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.attribution.evidence')}</span>
              <input value={evidence} maxLength={1000} onChange={(event) => setEvidence(event.target.value)} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.attribution.creditFrom')}</span>
              <input type="date" value={creditFrom} max={today} onChange={(event) => setCreditFrom(event.target.value)} className={INPUT} />
              <span className="u-micro text-ink-45">{t('admin.sales.attribution.creditFromHint')}</span>
            </label>
            <p className="u-micro rounded-lg border border-warning/40 bg-warning-tint p-2 text-ink-70">{t('admin.sales.attribution.paidStays')}</p>
            <DialogFooter>
              <button type="button" className={BUTTON} onClick={() => setOpen(false)}>{t('common.actions.cancel')}</button>
              <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending || !repId || reasonLength < 20}>
                {t('admin.sales.attribution.confirm')}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
